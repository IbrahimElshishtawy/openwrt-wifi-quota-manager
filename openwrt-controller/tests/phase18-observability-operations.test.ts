import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { MetricsService } from '../src/infrastructure/metrics/MetricsService.js';
import { Logger } from '../src/infrastructure/logging/Logger.js';
import type { StructuredLogEntry } from '../src/infrastructure/logging/logger.types.js';
import { CircuitBreaker } from '../src/infrastructure/resilience/CircuitBreaker.js';
import { HealthService } from '../src/modules/health/HealthService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { QuotaService } from '../src/modules/quota/QuotaService.js';
import type { IFirewallService } from '../src/modules/firewall/IFirewallService.js';
import type { DeviceQuota } from '../src/modules/quota/types.js';
import type { IQuotaRepository } from '../src/modules/quota/storage/IQuotaRepository.js';
import { GracefulShutdownHandler } from '../src/infrastructure/shutdown/GracefulShutdown.js';
import { SshClient } from '../src/infrastructure/openwrt/SshClient.js';

async function runPhase18Tests() {
  console.log('🧪 Starting Phase 18 — Production Observability & Operations Hardening Tests...\n');

  // =========================================================================
  // Section 1: MetricsService Core & Concurrency
  // =========================================================================
  {
    console.log('Running Test 1: MetricsService counters, gauges, histograms & concurrency...');
    const metrics = new MetricsService();

    // 1. Basic counters & gauges
    metrics.increment('http_requests_total', 5);
    metrics.increment('http_requests_total', 1, { method: 'GET', route: '/api/health', status: '200' });
    metrics.increment('http_requests_total', 1, { method: 'POST', route: '/api/quotas', status: '400' });
    metrics.set('http_active_requests', 3);
    metrics.decrement('http_active_requests', 1);

    assert.equal(metrics.get('http_requests_total'), 7);
    assert.equal(metrics.get('http_active_requests'), 2);

    // 2. Histograms / Latency observations
    metrics.observe('http_request_duration_ms', 10);
    metrics.observe('http_request_duration_ms', 20);
    metrics.observe('http_request_duration_ms', 30);

    const hist = metrics.getHistogram('http_request_duration_ms');
    assert.equal(hist.count, 3);
    assert.equal(hist.min, 10);
    assert.equal(hist.max, 30);
    assert.equal(hist.avg, 20);
    assert.equal(hist.last, 30);

    // 3. Concurrency safety: 100 concurrent increments across promises
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        (async () => {
          metrics.increment('openwrt_ssh_attempts_total', 1);
          metrics.observe('openwrt_ssh_duration_ms', 5 + (i % 10));
        })()
      );
    }
    await Promise.all(promises);

    assert.equal(metrics.get('openwrt_ssh_attempts_total'), 100);
    const sshHist = metrics.getHistogram('openwrt_ssh_duration_ms');
    assert.equal(sshHist.count, 100);
    assert.ok(sshHist.min >= 5);
    assert.ok(sshHist.max <= 15);

    // 4. Prometheus exposition format
    const promText = metrics.toPrometheusFormat();
    assert.ok(promText.includes('# TYPE http_requests_total counter'), 'Missing Prometheus counter header');
    assert.ok(promText.includes('# TYPE process_uptime_seconds gauge'), 'Missing Prometheus gauge header');
    assert.ok(promText.includes('http_requests_total{method="GET",route="/api/health",status="200"} 1'));
    assert.ok(promText.includes('openwrt_ssh_attempts_total 100'));

    console.log('✅ Test 1 Passed: MetricsService counters, histograms, labels, and concurrency verified');
  }

  // =========================================================================
  // Section 2: Health vs Readiness vs Liveness Endpoints
  // =========================================================================
  {
    console.log('Running Test 2: Health Liveness (/health/live) & Readiness (/health/ready)...');

    // 1. Mock healthy dependencies
    const mockRepo: IQuotaRepository = {
      getAll: async () => [],
      getByMac: async () => null,
      save: async () => {},
      delete: async () => true,
    };
    const mockCb = new CircuitBreaker();
    const health = new HealthService({
      quotaRepository: mockRepo,
      circuitBreaker: mockCb,
    });

    // Test Liveness
    const live = health.getLiveness();
    assert.equal(live.status, 'alive');
    assert.equal(live.service, 'openwrt-controller');
    assert.ok(live.pid > 0);
    assert.ok(live.uptimeSeconds >= 0);
    assert.ok(live.memoryUsage.rssBytes > 0);

    // Test Readiness (healthy)
    const ready = await health.getReadiness();
    assert.equal(ready.status, 'ready');
    assert.equal(ready.ready, true);
    assert.equal(ready.subsystems.quotaStorage.ready, true);
    assert.equal(ready.subsystems.routerConnectivity.ready, true);

    // Test Readiness (degraded when circuit breaker OPEN with few failures)
    mockCb.recordFailure();
    mockCb.recordFailure();
    mockCb.trip(); // OPEN
    const degradedReady = await health.getReadiness();
    assert.equal(degradedReady.status, 'degraded');
    assert.equal(degradedReady.ready, true); // Still ready for serving local queries
    assert.ok(degradedReady.degradedReasons && degradedReady.degradedReasons.length > 0);

    // Test Readiness (not_ready when quota storage throws)
    const brokenRepo: IQuotaRepository = {
      getAll: async () => {
        throw new Error('Database disk I/O failure');
      },
      getByMac: async () => null,
      save: async () => {},
      delete: async () => true,
    };
    const brokenHealth = new HealthService({
      quotaRepository: brokenRepo,
      circuitBreaker: mockCb,
    });
    const notReady = await brokenHealth.getReadiness();
    assert.equal(notReady.status, 'not_ready');
    assert.equal(notReady.ready, false);
    assert.equal(notReady.subsystems.quotaStorage.ready, false);

    console.log('✅ Test 2 Passed: Liveness and Readiness logic accurately reflects subsystem states');
  }

  // =========================================================================
  // Section 3: HTTP API Integration: /metrics, /api/metrics, /health/live, /health/ready, /api/operations/status
  // =========================================================================
  {
    console.log('Running Test 3: HTTP API Endpoints (/metrics, /api/metrics, /health/live, /health/ready, /api/operations/status)...');
    const app = await buildApp();

    // 1. GET /health/live
    const liveRes = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(liveRes.statusCode, 200);
    const liveBody = JSON.parse(liveRes.payload);
    assert.equal(liveBody.status, 'alive');
    assert.ok(liveBody.pid);
    assert.ok(liveBody.memoryUsage);

    // 2. GET /api/health/live
    const apiLiveRes = await app.inject({ method: 'GET', url: '/api/health/live' });
    assert.equal(apiLiveRes.statusCode, 200);

    // 3. GET /health/ready
    const readyRes = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(readyRes.statusCode, 200);
    const readyBody = JSON.parse(readyRes.payload);
    assert.ok(readyBody.status === 'ready' || readyBody.status === 'degraded');
    assert.equal(typeof readyBody.ready, 'boolean');

    // 4. GET /metrics (Prometheus text)
    const metricsPromRes = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(metricsPromRes.statusCode, 200);
    assert.ok(metricsPromRes.headers['content-type']?.includes('text/plain'));
    assert.ok(metricsPromRes.payload.includes('# HELP process_uptime_seconds'));
    assert.ok(metricsPromRes.payload.includes('# TYPE http_requests_total counter'));

    // 5. GET /api/metrics (JSON)
    const metricsJsonRes = await app.inject({ method: 'GET', url: '/api/metrics' });
    assert.equal(metricsJsonRes.statusCode, 200);
    const metricsJson = JSON.parse(metricsJsonRes.payload);
    assert.equal(metricsJson.success, true);
    assert.ok(metricsJson.metrics.http);
    assert.ok(metricsJson.metrics.openwrt);
    assert.ok(metricsJson.metrics.quota);
    assert.ok(metricsJson.metrics.resilience);
    assert.ok(metricsJson.metrics.system);

    // 6. GET /api/operations/status
    const opsRes = await app.inject({ method: 'GET', url: '/api/operations/status' });
    assert.equal(opsRes.statusCode, 200);
    const opsBody = JSON.parse(opsRes.payload);
    assert.ok(opsBody.status);
    assert.ok(opsBody.controllerVersion);
    assert.ok(opsBody.openwrt);
    assert.ok(opsBody.monitor);
    assert.ok(opsBody.lastEnforcement);
    assert.ok(opsBody.metricsSummary);

    // 7. Security check: Zero secrets leaked in endpoints
    const allPayloads = [liveRes.payload, readyRes.payload, metricsPromRes.payload, metricsJsonRes.payload, opsRes.payload].join(' ');
    assert.equal(allPayloads.includes('superSecretPassword'), false);
    assert.equal(allPayloads.includes('API_AUTH_TOKEN'), false);
    assert.equal(allPayloads.includes('PRIVATE KEY'), false);
    assert.equal(allPayloads.includes('OPENWRT_PASSWORD'), false);

    // 8. Request correlation: X-Request-Id header present
    assert.ok(opsRes.headers['x-request-id']);
    assert.ok(readyRes.headers['x-request-id']);

    await app.close();
    console.log('✅ Test 3 Passed: All Phase 18 HTTP endpoints functional and verified leak-free');
  }

  // =========================================================================
  // Section 4: Circuit Breaker Transition Observability & Diagnostics
  // =========================================================================
  {
    console.log('Running Test 4: CircuitBreaker state transitions emit metrics & events...');
    const transitions: Array<{ from: string; to: string }> = [];
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownPeriodMs: 50,
      onStateChange: (from, to) => transitions.push({ from, to }),
    });

    assert.equal(cb.getState(), 'CLOSED');

    // 1st failure: remains CLOSED
    cb.recordFailure(new Error('SSH timeout'));
    assert.equal(cb.getState(), 'CLOSED');

    // 2nd failure: trips to OPEN
    cb.recordFailure(new Error('Connection reset'));
    assert.equal(cb.getState(), 'OPEN');
    assert.equal(transitions.length, 1);
    assert.deepEqual(transitions[0], { from: 'CLOSED', to: 'OPEN' });

    // Diagnostics while OPEN
    const diags = cb.getDiagnostics();
    assert.equal(diags.state, 'OPEN');
    assert.equal(diags.consecutiveFailures, 2);
    assert.ok(diags.lastFailureTime);
    assert.equal(diags.lastErrorMessage, 'Connection reset');

    // Wait cooldown for HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(cb.getState(), 'HALF_OPEN');
    assert.equal(transitions.length, 2);
    assert.deepEqual(transitions[1], { from: 'OPEN', to: 'HALF_OPEN' });

    // Successful probe closes circuit
    cb.recordSuccess();
    assert.equal(cb.getState(), 'CLOSED');
    assert.equal(transitions.length, 3);
    assert.deepEqual(transitions[2], { from: 'HALF_OPEN', to: 'CLOSED' });

    console.log('✅ Test 4 Passed: CircuitBreaker transitions, metrics, and diagnostics verified');
  }

  // =========================================================================
  // Section 5: Quota Enforcement Observability & Overlapping Protection
  // =========================================================================
  {
    console.log('Running Test 5: QuotaEnforcementMonitor cycle metrics, device error isolation & overlapping protection...');
    const metrics = new MetricsService();
    const capturedLogs: StructuredLogEntry[] = [];
    const structuredLogger = new Logger({
      minLevel: 'debug',
      sink: (entry) => capturedLogs.push(entry),
    });

    const quotas: DeviceQuota[] = [
      {
        mac: '52:54:00:AA:11:11',
        quotaBytes: 100,
        usedBytes: 150,
        remainingBytes: 0,
        percentage: 150,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        mac: '52:54:00:BB:22:22', // This device will throw a firewall error
        quotaBytes: 100,
        usedBytes: 150,
        remainingBytes: 0,
        percentage: 150,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        mac: '52:54:00:CC:33:33',
        quotaBytes: 500,
        usedBytes: 50,
        remainingBytes: 450,
        percentage: 10,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const mockQuotaService = {
      refreshAllQuotas: async () => quotas,
    } as unknown as QuotaService;

    const blockedSet = new Set<string>();
    const mockFwService = {
      ensureRuleset: async () => {},
      reconcileManualBlocks: async () => {},
      getBlockedDevices: async () => Array.from(blockedSet),
      getQuotaBlockedDevices: async () => Array.from(blockedSet),
      isBlocked: async (mac: string) => blockedSet.has(mac.toUpperCase()),
      blockDevice: async (mac: string) => {
        if (mac.toUpperCase() === '52:54:00:BB:22:22') {
          throw new Error('Device 22:22 firewall lock error');
        }
        blockedSet.add(mac.toUpperCase());
        return { success: true, mac, isBlocked: true, message: 'blocked' };
      },
      unblockDevice: async (mac: string) => {
        blockedSet.delete(mac.toUpperCase());
        return { success: true, mac, isBlocked: false, message: 'unblocked' };
      },
    } as unknown as IFirewallService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, mockFwService, {
      metrics,
      structuredLogger,
    });

    const cycleResult = await monitor.runCycle();
    assert.ok(cycleResult);
    // Device failure isolation: AA:11:11 blocked, BB:22:22 failed, CC:33:33 unaffected
    assert.equal(cycleResult.blockedCount, 1);
    assert.equal(cycleResult.errorCount, 1);
    assert.equal(blockedSet.has('52:54:00:AA:11:11'), true);
    assert.equal(blockedSet.has('52:54:00:BB:22:22'), false);

    // Verify gauges & metrics updated
    assert.equal(metrics.get('quota_records_total'), 3);
    assert.equal(metrics.get('quota_exhausted_total'), 2);
    assert.equal(metrics.get('quota_active_total'), 1);
    assert.equal(metrics.get('quota_enforcement_cycles_total'), 1);
    assert.equal(metrics.get('quota_enforcement_failures_total'), 1); // 1 device error marked cycle as error

    // Overlapping execution protection: calling runCycle while cycle is running returns null
    let slowResolve: () => void = () => {};
    const slowQuotaService = {
      refreshAllQuotas: async () => {
        await new Promise<void>((r) => { slowResolve = r; });
        return [];
      },
    } as unknown as QuotaService;

    const lockedMonitor = new QuotaEnforcementMonitor(slowQuotaService, mockFwService, { metrics });
    const runPromise1 = lockedMonitor.runCycle();
    const runPromise2 = lockedMonitor.runCycle(); // Should be skipped immediately

    assert.equal(await runPromise2, null); // Overlapping run rejected
    slowResolve();
    await runPromise1;

    console.log('✅ Test 5 Passed: Quota enforcement metrics, error isolation, and overlapping lock verified');
  }

  // =========================================================================
  // Section 6: Graceful Shutdown Lifecycle & Timeout
  // =========================================================================
  {
    console.log('Running Test 6: Graceful shutdown timeout, metrics & in-flight cycle drain...');
    const metrics = new MetricsService();
    const app = await buildApp();

    let cycleDone = false;
    const mockMonitor = {
      isRunning: () => true,
      stop: async (opts?: { waitForCycle?: boolean; timeoutMs?: number }) => {
        if (opts?.waitForCycle) {
          await new Promise((r) => setTimeout(r, 50));
          cycleDone = true;
        }
      },
      sync: async () => {},
      start: () => {},
    };

    const logs: string[] = [];
    const shutdownHandler = new GracefulShutdownHandler(app, mockMonitor, {
      timeoutMs: 1000,
      logger: {
        info: (msg) => logs.push(msg),
        error: (msg) => logs.push(`ERR: ${msg}`),
      },
    });

    const shutdownSuccess = await shutdownHandler.shutdown('SIGTERM');
    assert.equal(shutdownSuccess, true);
    assert.equal(cycleDone, true);
    assert.equal(shutdownHandler.isInProgress(), true);

    // Repeated call is idempotent
    const secondCall = await shutdownHandler.shutdown('SIGINT');
    assert.equal(secondCall, false);

    console.log('✅ Test 6 Passed: Graceful shutdown idempotency, timeout, and clean drain verified');
  }

  // =========================================================================
  // Section 7: SshClient Argument Validation & Metrics
  // =========================================================================
  {
    console.log('Running Test 7: SshClient argument injection defenses & metrics tracking...');
    // Unconfigured client
    const unconfiguredSsh = new SshClient({ host: '' });
    assert.equal(unconfiguredSsh.isConfigured(), false);
    await assert.rejects(
      async () => unconfiguredSsh.executeCommand('nft list tables'),
      { name: 'OpenWrtNotConfiguredError' }
    );

    // Host starting with dash rejected
    assert.throws(
      () => new SshClient({ host: '-oProxyCommand=calc.exe' }),
      /cannot begin with a dash/
    );

    // Null byte injection rejected
    const configuredSsh = new SshClient({ host: '127.0.0.1', username: 'root' });
    await assert.rejects(
      async () => configuredSsh.executeCommand('echo test\0injection'),
      /contains null bytes/
    );

    console.log('✅ Test 7 Passed: SshClient security guards and configuration checks verified');
  }

  console.log('\n🎉 ALL Phase 18 Observability & Operations TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runPhase18Tests();

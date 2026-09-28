import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { healthRoutes } from '../src/modules/health/health.routes.js';
import { HealthService } from '../src/modules/health/HealthService.js';
import { HealthController } from '../src/modules/health/HealthController.js';
import type { HealthReport } from '../src/modules/health/types.js';
import { CircuitBreaker } from '../src/infrastructure/resilience/CircuitBreaker.js';
import type { IQuotaRepository } from '../src/modules/quota/storage/IQuotaRepository.js';
import type { IQuotaEnforcementMonitor, EnforcementMonitorStatus } from '../src/modules/quota/QuotaEnforcementMonitor.js';

function createMockQuotaRepo(overrides: Partial<IQuotaRepository> = {}): IQuotaRepository {
  return {
    getAll: async () => [],
    getByMac: async () => null,
    create: async () => {},
    update: async () => {},
    delete: async () => true,
    exists: async () => false,
    findById: async () => null,
    findAll: async () => [],
    save: async () => {},
    ...overrides,
  };
}

async function runHealthTests() {
  console.log('🧪 Starting Health Endpoint Integration Tests (GET /api/health)...');

  // Test 1: GET /api/health and /health under healthy conditions
  {
    console.log('Running Test 1: Healthy status returns HTTP 200 with structured status...');
    const circuitBreaker = new CircuitBreaker();
    const mockRepo = createMockQuotaRepo();
    const mockMonitor = {
      start: () => {},
      stop: () => {},
      sync: async () => {},
      isRunning: () => true,
      getStatus: (): EnforcementMonitorStatus => ({
        running: true,
        intervalMs: 5000,
        enabled: true,
        lastRunAt: '2026-09-28T05:00:00.000Z',
        lastRunDurationMs: 85,
        lastRunSuccess: true,
        lastError: null,
        totalRuns: 10,
        consecutiveErrors: 0,
      }),
    };

    const healthService = new HealthService({
      circuitBreaker,
      quotaRepository: mockRepo,
      monitor: mockMonitor,
    });
    const controller = new HealthController(healthService);

    const app = Fastify();
    await app.register(healthRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<HealthReport>();
    assert.equal(body.status, 'healthy');
    assert.equal(body.firewall.status, 'healthy');
    assert.equal(body.quota.status, 'healthy');
    assert.equal(body.reconciliation.status, 'healthy');
    assert.equal(body.reconciliation.lastSuccessAt, '2026-09-28T05:00:00.000Z');
    assert.equal(body.reconciliation.lastDurationMs, 85);
    assert.ok(typeof body.uptimeSeconds === 'number');
    assert.ok(body.timestamp);

    // Verify /health compatibility alias
    const aliasRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.equal(aliasRes.statusCode, 200);
    const aliasBody = aliasRes.json<HealthReport>();
    assert.equal(aliasBody.status, 'healthy');

    await app.close();
    console.log('✅ Test 1 Passed: Healthy state returns HTTP 200 for /api/health and /health');
  }

  // Test 2: Degraded state when router circuit breaker is OPEN
  {
    console.log('Running Test 2: Degraded status returns HTTP 200 when circuit breaker is OPEN...');
    const circuitBreaker = new CircuitBreaker();
    circuitBreaker.trip(); // Force OPEN state

    const mockRepo = createMockQuotaRepo();
    const mockMonitor = {
      start: () => {},
      stop: () => {},
      sync: async () => {},
      isRunning: () => true,
      getStatus: (): EnforcementMonitorStatus => ({
        running: true,
        intervalMs: 5000,
        enabled: true,
        lastRunAt: '2026-09-28T05:00:00.000Z',
        lastRunDurationMs: 50,
        lastRunSuccess: false,
        lastError: 'OpenWrt router connection timed out',
        totalRuns: 5,
        consecutiveErrors: 2,
      }),
    };

    const healthService = new HealthService({
      circuitBreaker,
      quotaRepository: mockRepo,
      monitor: mockMonitor,
    });
    const controller = new HealthController(healthService);

    const app = Fastify();
    await app.register(healthRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<HealthReport>();
    assert.equal(body.status, 'degraded');
    assert.equal(body.firewall.status, 'degraded');
    assert.equal(body.firewall.circuitBreaker, 'OPEN');
    assert.equal(body.reconciliation.status, 'degraded');

    await app.close();
    console.log('✅ Test 2 Passed: OpenWrt connectivity issues report degraded status');
  }

  // Test 3: Unhealthy state when repeated failures persist (HTTP 503)
  {
    console.log('Running Test 3: Unhealthy status returns HTTP 503 when repeated failures occur...');
    const circuitBreaker = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure();

    const mockRepo = createMockQuotaRepo();
    const mockMonitor = {
      start: () => {},
      stop: () => {},
      sync: async () => {},
      isRunning: () => true,
      getStatus: (): EnforcementMonitorStatus => ({
        running: true,
        intervalMs: 5000,
        enabled: true,
        lastRunAt: '2026-09-28T05:00:00.000Z',
        lastRunDurationMs: 50,
        lastRunSuccess: false,
        lastError: 'Persistent SSH failure',
        totalRuns: 20,
        consecutiveErrors: 6,
      }),
    };

    const healthService = new HealthService({
      circuitBreaker,
      quotaRepository: mockRepo,
      monitor: mockMonitor,
    });
    const controller = new HealthController(healthService);

    const app = Fastify();
    await app.register(healthRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    assert.equal(res.statusCode, 503);
    const body = res.json<HealthReport>();
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.firewall.status, 'unhealthy');
    assert.equal(body.reconciliation.status, 'unhealthy');

    await app.close();
    console.log('✅ Test 3 Passed: Persistent failures accurately return HTTP 503 unhealthy');
  }

  // Test 4: Quota storage failure causes unhealthy status
  {
    console.log('Running Test 4: Quota storage failure causes unhealthy status...');
    const circuitBreaker = new CircuitBreaker();
    const brokenRepo = createMockQuotaRepo({
      findAll: async () => { throw new Error('Disk I/O error'); },
      getAll: async () => { throw new Error('Disk I/O error'); },
    });

    const healthService = new HealthService({
      circuitBreaker,
      quotaRepository: brokenRepo,
    });
    const controller = new HealthController(healthService);

    const app = Fastify();
    await app.register(healthRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    assert.equal(res.statusCode, 503);
    const body = res.json<HealthReport>();
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.quota.status, 'unhealthy');

    await app.close();
    console.log('✅ Test 4 Passed: Storage failures accurately return HTTP 503');
  }

  // Test 5: Recovery back to healthy
  {
    console.log('Running Test 5: Subsystem recovery transitions status back to healthy...');
    const circuitBreaker = new CircuitBreaker();
    circuitBreaker.trip(); // start degraded

    let consecutiveErrors = 3;
    const mockMonitor = {
      start: () => {},
      stop: () => {},
      sync: async () => {},
      isRunning: () => true,
      getStatus: (): EnforcementMonitorStatus => ({
        running: true,
        intervalMs: 5000,
        enabled: true,
        lastRunAt: new Date().toISOString(),
        lastRunDurationMs: 40,
        lastRunSuccess: consecutiveErrors === 0,
        lastError: consecutiveErrors === 0 ? null : 'Router error',
        totalRuns: 10,
        consecutiveErrors,
      }),
    };

    const mockRepo = createMockQuotaRepo();

    const healthService = new HealthService({
      circuitBreaker,
      quotaRepository: mockRepo,
      monitor: mockMonitor,
    });
    const controller = new HealthController(healthService);

    const app = Fastify();
    await app.register(healthRoutes, { controller });

    // 1. Initially degraded
    const degradedRes = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(degradedRes.json<HealthReport>().status, 'degraded');

    // 2. Router recovers: circuit breaker resets, monitor errors clear
    circuitBreaker.reset();
    consecutiveErrors = 0;

    const recoveredRes = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(recoveredRes.statusCode, 200);
    assert.equal(recoveredRes.json<HealthReport>().status, 'healthy');

    await app.close();
    console.log('✅ Test 5 Passed: Dynamic recovery transitions health back to healthy');
  }

  console.log('\n🎉 ALL Health Endpoint TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runHealthTests();

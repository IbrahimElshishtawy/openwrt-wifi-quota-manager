import assert from 'node:assert/strict';
import { Logger } from '../src/infrastructure/logging/Logger.js';
import type { StructuredLogEntry } from '../src/infrastructure/logging/logger.types.js';
import { MetricsService } from '../src/infrastructure/metrics/MetricsService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { QuotaService } from '../src/modules/quota/QuotaService.js';
import type { IFirewallService } from '../src/modules/firewall/IFirewallService.js';
import type { DeviceQuota } from '../src/modules/quota/types.js';

async function runObservabilityTests() {
  console.log('🧪 Starting Production Observability Tests (Structured Logging & Metrics)...');

  // Test 1: Structured Logger basic formatting and levels
  {
    console.log('Running Test 1: Structured Logger JSON formatting and levels...');
    const captured: StructuredLogEntry[] = [];
    const logger = new Logger({
      minLevel: 'debug',
      sink: (entry) => captured.push(entry),
    });

    logger.debug('debug_event', { detail: 'trace info' });
    logger.info('quota_exhausted', { mac: 'AA:BB:CC:DD:EE:FF', usedBytes: 1000, quotaBytes: 1000 });
    logger.warn('firewall_warning', { warning: 'transient' });
    logger.error('operation_failed', { error: 'SSH connection refused' });

    assert.equal(captured.length, 4);
    assert.equal(captured[0].level, 'debug');
    assert.equal(captured[0].event, 'debug_event');
    assert.equal(captured[1].level, 'info');
    assert.equal(captured[1].event, 'quota_exhausted');
    assert.equal(captured[1].mac, 'AA:BB:CC:DD:EE:FF');
    assert.equal(captured[1].usedBytes, 1000);
    assert.equal(captured[2].level, 'warn');
    assert.equal(captured[3].level, 'error');
    console.log('✅ Test 1 Passed: Logger supports debug, info, warn, error levels');
  }

  // Test 2: Redaction of secrets and preservation of MAC addresses
  {
    console.log('Running Test 2: Secret redaction in logs...');
    const captured: StructuredLogEntry[] = [];
    const logger = new Logger({
      minLevel: 'debug',
      sink: (entry) => captured.push(entry),
    });

    logger.info('auth_attempt', {
      password: 'superSecretPassword123',
      token: 'jwt-token-xyz',
      secret: 'my-secret-key',
      mac: '11:22:33:44:55:66',
      message: 'Connecting with password=superSecretPassword123 and token=jwt-token-xyz',
    });

    assert.equal(captured.length, 1);
    const entry = captured[0];
    assert.equal(entry.password, '[REDACTED]');
    assert.equal(entry.token, '[REDACTED]');
    assert.equal(entry.secret, '[REDACTED]');
    assert.equal(entry.mac, '11:22:33:44:55:66');
    assert.equal(entry.message?.includes('superSecretPassword123'), false);
    assert.equal(entry.message?.includes('password=[REDACTED]'), true);
    console.log('✅ Test 2 Passed: Sensitive credentials redacted while MAC address is preserved');
  }

  // Test 3: Correlation ID propagation across reconciliation cycle
  {
    console.log('Running Test 3: Correlation ID preserved across monitor reconciliation cycle...');
    const captured: StructuredLogEntry[] = [];
    const structuredLogger = new Logger({
      minLevel: 'debug',
      sink: (entry) => captured.push(entry),
    });

    const metrics = new MetricsService();

    const quotas: DeviceQuota[] = [
      {
        mac: 'AA:BB:CC:DD:EE:01',
        quotaBytes: 1000,
        usedBytes: 1500,
        remainingBytes: 0,
        percentage: 150,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const mockQuotaService = {
      refreshAllQuotas: async () => quotas,
    } as unknown as QuotaService;

    const blockedSet = new Set<string>();
    const mockFirewallService = {
      ensureRuleset: async () => {},
      reconcileManualBlocks: async () => {},
      getBlockedDevices: async () => Array.from(blockedSet),
      getQuotaBlockedDevices: async () => Array.from(blockedSet),
      isBlocked: async (mac: string) => blockedSet.has(mac.toUpperCase()),
      blockDevice: async (mac: string) => {
        blockedSet.add(mac.toUpperCase());
        return { success: true, mac, isBlocked: true, message: 'blocked' };
      },
      unblockDevice: async (mac: string) => {
        blockedSet.delete(mac.toUpperCase());
        return { success: true, mac, isBlocked: false, message: 'unblocked' };
      },
    } as unknown as IFirewallService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, mockFirewallService, {
      structuredLogger,
      metrics,
    });

    const result = await monitor.runCycle();
    assert.ok(result);
    assert.ok(result.reconciliationId);

    // Filter events generated for this cycle
    const cycleEntries = captured.filter((e) => e.reconciliationId === result.reconciliationId);
    assert.ok(cycleEntries.length >= 3, `Expected at least 3 cycle entries, got ${cycleEntries.length}`);

    // Verify all entries share the exact same correlation ID
    for (const entry of cycleEntries) {
      assert.equal(entry.reconciliationId, result.reconciliationId);
    }

    const events = cycleEntries.map((e) => e.event);
    assert.ok(events.includes('reconciliation_started'), 'Expected reconciliation_started');
    assert.ok(events.includes('quota_exhausted'), 'Expected quota_exhausted');
    assert.ok(events.includes('device_blocked'), 'Expected device_blocked');
    assert.ok(events.includes('reconciliation_completed'), 'Expected reconciliation_completed');

    console.log('✅ Test 3 Passed: Correlation ID consistently preserved across all cycle log events');
  }

  // Test 4: In-process MetricsService counters and snapshots
  {
    console.log('Running Test 4: MetricsService increment, set, snapshot, and reset...');
    const metrics = new MetricsService();

    assert.equal(metrics.get('reconciliation_runs'), 0);
    metrics.increment('reconciliation_runs');
    metrics.increment('reconciliation_runs', 2);
    assert.equal(metrics.get('reconciliation_runs'), 3);

    metrics.increment('devices_blocked', 5);
    metrics.increment('devices_unblocked', 2);
    metrics.set('ssh_failures', 4);

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.reconciliation_runs, 3);
    assert.equal(snapshot.devices_blocked, 5);
    assert.equal(snapshot.devices_unblocked, 2);
    assert.equal(snapshot.ssh_failures, 4);

    metrics.reset();
    assert.equal(metrics.get('reconciliation_runs'), 0);
    assert.equal(metrics.get('devices_blocked'), 0);
    assert.equal(metrics.get('ssh_failures'), 0);
    console.log('✅ Test 4 Passed: MetricsService operations verified');
  }

  // Test 5: Metrics recorded during monitor execution
  {
    console.log('Running Test 5: QuotaEnforcementMonitor updates internal metrics during execution...');
    const metrics = new MetricsService();

    const quotas: DeviceQuota[] = [
      {
        mac: '52:54:00:11:11:11',
        quotaBytes: 100,
        usedBytes: 150,
        remainingBytes: 0,
        percentage: 150,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        mac: '52:54:00:22:22:22',
        quotaBytes: 500,
        usedBytes: 100,
        remainingBytes: 400,
        percentage: 20,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const mockQuotaService = {
      refreshAllQuotas: async () => quotas,
    } as unknown as QuotaService;

    const quotaBlocked = new Set<string>(['52:54:00:22:22:22', '52:54:00:99:99:99']);
    const mockFirewallService = {
      ensureRuleset: async () => {},
      reconcileManualBlocks: async () => {},
      getBlockedDevices: async () => Array.from(quotaBlocked),
      getQuotaBlockedDevices: async () => Array.from(quotaBlocked),
      isBlocked: async (mac: string, source?: string) => {
        if (source === 'manual') return false;
        if (source === 'quota') return quotaBlocked.has(mac.toUpperCase());
        return quotaBlocked.has(mac.toUpperCase());
      },
      blockDevice: async (mac: string) => {
        quotaBlocked.add(mac.toUpperCase());
        return { success: true, mac, isBlocked: true, message: 'blocked' };
      },
      unblockDevice: async (mac: string) => {
        quotaBlocked.delete(mac.toUpperCase());
        return { success: true, mac, isBlocked: false, message: 'unblocked' };
      },
    } as unknown as IFirewallService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, mockFirewallService, {
      metrics,
    });

    await monitor.runCycle();

    const snap = metrics.snapshot();
    assert.equal(snap.reconciliation_runs, 1);
    assert.equal(snap.reconciliation_successes, 1);
    assert.equal(snap.reconciliation_failures, 0);
    assert.equal(snap.quota_devices_evaluated, 2);
    assert.equal(snap.quota_devices_exhausted, 1);
    assert.equal(snap.devices_blocked, 1); // 11:11:11 was blocked
    assert.equal(snap.devices_unblocked, 2); // 22:22:22 (stale) + 99:99:99 (orphan)
    assert.equal(snap.orphan_blocks_detected, 1);
    assert.equal(snap.orphan_blocks_removed, 1);
    assert.ok(snap.firewall_operations >= 3);
    assert.ok(snap.recovery_actions >= 3);
    console.log('✅ Test 5 Passed: Metrics accurately captured during reconciliation cycle');
  }

  // Test 6: Metrics and error logs on failure
  {
    console.log('Running Test 6: Metrics and logging when router throws SSH connection failure...');
    const captured: StructuredLogEntry[] = [];
    const structuredLogger = new Logger({
      minLevel: 'debug',
      sink: (entry) => captured.push(entry),
    });
    const metrics = new MetricsService();

    const failingQuotaService = {
      refreshAllQuotas: async () => {
        throw new Error('SSH command timed out after 5000ms while contacting 192.168.1.1:22');
      },
    } as unknown as QuotaService;

    const mockFirewallService = {} as unknown as IFirewallService;

    const monitor = new QuotaEnforcementMonitor(failingQuotaService, mockFirewallService, {
      structuredLogger,
      metrics,
    });

    const result = await monitor.runCycle();
    assert.ok(result);
    assert.equal(result.success, false);

    const snap = metrics.snapshot();
    assert.equal(snap.reconciliation_runs, 1);
    assert.equal(snap.reconciliation_failures, 1);
    assert.equal(snap.ssh_failures, 1);

    const errorLogs = captured.filter((e) => e.level === 'error');
    assert.ok(errorLogs.length >= 1);
    assert.equal(errorLogs[0].category, 'SSH_FAILURE');
    console.log('✅ Test 6 Passed: Failure metrics and classified error logs verified');
  }

  console.log('\n🎉 ALL Observability & Metrics TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runObservabilityTests();

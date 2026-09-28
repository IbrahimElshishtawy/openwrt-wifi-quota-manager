import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { quotaEnforcementRoutes } from '../src/modules/quota-enforcement/quota-enforcement.routes.js';
import { QuotaEnforcementController } from '../src/modules/quota-enforcement/QuotaEnforcementController.js';
import type { QuotaEnforcementStatusResponse } from '../src/modules/quota-enforcement/types.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { QuotaService } from '../src/modules/quota/QuotaService.js';
import type { IFirewallService } from '../src/modules/firewall/IFirewallService.js';
import type { DeviceQuota } from '../src/modules/quota/types.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function runStatusEndpointTests() {
  console.log('🧪 Starting Quota Enforcement Status Endpoint Tests (GET /api/quota-enforcement/status)...');

  // Test 1: Initial state before any run
  {
    console.log('Running Test 1: Initial operational telemetry before any cycles...');
    const monitor = new QuotaEnforcementMonitor(
      {} as unknown as QuotaService,
      {} as unknown as IFirewallService,
      {
        intervalMs: 5000,
        logger: silentLogger,
      }
    );

    const controller = new QuotaEnforcementController(monitor);
    const app = Fastify();
    await app.register(quotaEnforcementRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    assert.equal(body.running, false);
    assert.equal(body.syncInProgress, false);
    assert.equal(body.intervalMs, 5000);
    assert.equal(body.lastStartedAt, null);
    assert.equal(body.lastCompletedAt, null);
    assert.equal(body.lastSuccessfulAt, null);
    assert.equal(body.lastFailureAt, null);
    assert.equal(body.lastDurationMs, null);
    assert.equal(body.devicesEvaluated, 0);
    assert.equal(body.devicesBlocked, 0);
    assert.equal(body.devicesUnblocked, 0);
    assert.equal(body.totalRuns, 0);
    assert.equal(body.consecutiveErrors, 0);

    // Verify /quota-enforcement/status alias
    const aliasRes = await app.inject({
      method: 'GET',
      url: '/quota-enforcement/status',
    });
    assert.equal(aliasRes.statusCode, 200);
    assert.equal(aliasRes.json<QuotaEnforcementStatusResponse>().success, true);

    await app.close();
    console.log('✅ Test 1 Passed: Initial status fields reported accurately');
  }

  // Test 2: Status update after successful cycle
  {
    console.log('Running Test 2: Status fields update after successful cycle...');
    const quotas: DeviceQuota[] = [
      {
        mac: '52:54:00:11:22:33',
        quotaBytes: 1000,
        usedBytes: 1500,
        remainingBytes: 0,
        percentage: 150,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        mac: '52:54:00:44:55:66',
        quotaBytes: 2000,
        usedBytes: 500,
        remainingBytes: 1500,
        percentage: 25,
        status: 'active',
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
      intervalMs: 8000,
      logger: silentLogger,
    });

    await monitor.runCycle();

    const controller = new QuotaEnforcementController(monitor);
    const app = Fastify();
    await app.register(quotaEnforcementRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    assert.equal(body.syncInProgress, false);
    assert.equal(body.intervalMs, 8000);
    assert.ok(body.lastStartedAt);
    assert.ok(body.lastCompletedAt);
    assert.ok(body.lastSuccessfulAt);
    assert.equal(body.lastFailureAt, null);
    assert.ok(typeof body.lastDurationMs === 'number');
    assert.equal(body.devicesEvaluated, 2);
    assert.equal(body.devicesBlocked, 1);
    assert.equal(body.devicesUnblocked, 0);
    assert.ok(body.reconciliationId);
    assert.equal(body.totalRuns, 1);
    assert.equal(body.consecutiveErrors, 0);

    await app.close();
    console.log('✅ Test 2 Passed: Status reflects successful enforcement telemetry');
  }

  // Test 3: Status update after cycle error
  {
    console.log('Running Test 3: Status fields update after failed cycle...');
    const failingQuotaService = {
      refreshAllQuotas: async () => {
        throw new Error('Connection refused by OpenWrt router');
      },
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(
      failingQuotaService,
      {} as unknown as IFirewallService,
      {
        intervalMs: 5000,
        logger: silentLogger,
      }
    );

    await monitor.runCycle();

    const controller = new QuotaEnforcementController(monitor);
    const app = Fastify();
    await app.register(quotaEnforcementRoutes, { controller });

    const res = await app.inject({
      method: 'GET',
      url: '/api/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    assert.equal(body.lastRunSuccess, false);
    assert.ok(body.lastFailureAt);
    assert.equal(body.lastError, 'Connection refused by OpenWrt router');
    assert.equal(body.consecutiveErrors, 1);
    assert.equal(body.totalRuns, 1);

    await app.close();
    console.log('✅ Test 3 Passed: Error state correctly reported in status response');
  }

  console.log('\n🎉 ALL Quota Enforcement Status Endpoint TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runStatusEndpointTests();

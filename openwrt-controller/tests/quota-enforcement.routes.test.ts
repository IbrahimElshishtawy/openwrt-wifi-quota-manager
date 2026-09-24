import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { quotaEnforcementRoutes } from '../src/modules/quota-enforcement/quota-enforcement.routes.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota-enforcement/QuotaEnforcementMonitor.js';
import type { QuotaEnforcementService } from '../src/modules/quota-enforcement/QuotaEnforcementService.js';
import type { QuotaEnforcementStatusResponse } from '../src/modules/quota-enforcement/types.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function runRouteTests() {
  console.log('🧪 Starting QuotaEnforcement HTTP Integration Tests (/api/quota-enforcement/status)...');

  // Setup mock service and monitor
  const mockService = {
    enforceAll: async () => ({
      timestamp: '2026-09-24T18:00:00.000Z',
      durationMs: 75,
      totalEvaluated: 4,
      blockedCount: 1,
      unblockedCount: 0,
      unchangedCount: 3,
      errorCount: 0,
      results: [],
      success: true,
    }),
  } as unknown as QuotaEnforcementService;

  const monitor = new QuotaEnforcementMonitor(mockService, {
    intervalMs: 15000,
    logger: silentLogger,
  });

  const app = Fastify();
  await app.register(quotaEnforcementRoutes, { monitor });

  // Test 1: GET /api/quota-enforcement/status before running
  {
    console.log('Testing GET /api/quota-enforcement/status initial state...');
    const res = await app.inject({
      method: 'GET',
      url: '/api/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    assert.equal(body.running, false);
    assert.equal(body.intervalMs, 15000);
    assert.equal(body.lastRunAt, null);
    assert.equal(body.lastError, null);
    console.log('✅ GET /api/quota-enforcement/status returned initial state accurately');
  }

  // Test 2: GET /api/quota-enforcement/status while running
  {
    console.log('Testing GET /api/quota-enforcement/status active running state...');
    monitor.start();
    // Allow cycle to complete
    await new Promise((r) => setTimeout(r, 50));

    const res = await app.inject({
      method: 'GET',
      url: '/api/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    assert.equal(body.running, true);
    assert.equal(body.intervalMs, 15000);
    assert.equal(body.lastRunSuccess, true);
    assert.equal(body.totalRuns >= 1, true);
    assert.equal(body.lastRunDurationMs, 75);
    console.log('✅ GET /api/quota-enforcement/status returned active running state accurately');
    monitor.stop();
  }

  // Test 3: GET /quota-enforcement/status compatibility alias
  {
    console.log('Testing GET /quota-enforcement/status compatibility alias...');
    const res = await app.inject({
      method: 'GET',
      url: '/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    console.log('✅ GET /quota-enforcement/status alias passed');
  }

  // Test 4: Error reporting in status
  {
    console.log('Testing GET /api/quota-enforcement/status error state...');
    const failingService = {
      enforceAll: async () => {
        throw new Error('OpenWrt router connection refused');
      },
    } as unknown as QuotaEnforcementService;

    const failingMonitor = new QuotaEnforcementMonitor(failingService, {
      intervalMs: 10000,
      logger: silentLogger,
    });

    await failingMonitor.runCycle();

    const failingApp = Fastify();
    await failingApp.register(quotaEnforcementRoutes, { monitor: failingMonitor });

    const res = await failingApp.inject({
      method: 'GET',
      url: '/api/quota-enforcement/status',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<QuotaEnforcementStatusResponse>();
    assert.equal(body.success, true);
    assert.equal(body.lastRunSuccess, false);
    assert.equal(body.lastError, 'OpenWrt router connection refused');
    assert.equal(body.consecutiveErrors, 1);
    console.log('✅ GET /api/quota-enforcement/status reported error state accurately');

    await failingApp.close();
  }

  await app.close();
  console.log('\n🎉 ALL QuotaEnforcement HTTP Integration TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runRouteTests();

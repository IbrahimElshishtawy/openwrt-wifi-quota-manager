import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { GracefulShutdownHandler } from '../src/infrastructure/shutdown/GracefulShutdown.js';
import type { IQuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';

async function runShutdownTests() {
  console.log('🧪 Starting Graceful Shutdown Unit Tests...');

  const silentLogger = {
    info: () => {},
    error: () => {},
  };

  // Test 1: Standard shutdown stops monitor and closes app
  {
    console.log('Running Test 1: Standard shutdown stops monitor and closes app cleanly...');
    const app = Fastify();
    let monitorStopped = false;

    const mockMonitor: IQuotaEnforcementMonitor = {
      start: () => {},
      stop: () => {
        monitorStopped = true;
      },
      sync: async () => {},
      isRunning: () => true,
    };

    const handler = new GracefulShutdownHandler(app, mockMonitor, {
      logger: silentLogger,
      timeoutMs: 2000,
    });

    assert.equal(handler.isInProgress(), false);
    const shutdownResult = await handler.shutdown('SIGTERM');
    assert.equal(shutdownResult, true);
    assert.equal(handler.isInProgress(), true);
    assert.equal(monitorStopped, true);
    console.log('✅ Test 1 Passed: Monitor stopped and app closed cleanly');
  }

  // Test 2: In-flight reconciliation cycle is safely awaited before close
  {
    console.log('Running Test 2: In-flight reconciliation cycle safely awaited before shutdown...');
    const app = Fastify();
    let cycleFinished = false;

    const mockMonitor = {
      start: () => {},
      stop: async (options?: { waitForCycle?: boolean; timeoutMs?: number }) => {
        if (options?.waitForCycle) {
          // Simulate active cycle taking 100ms
          await new Promise((r) => setTimeout(r, 100));
          cycleFinished = true;
        }
      },
      sync: async () => {},
      isRunning: () => true,
    } as unknown as IQuotaEnforcementMonitor;

    const handler = new GracefulShutdownHandler(app, mockMonitor, {
      logger: silentLogger,
      timeoutMs: 2000,
    });

    await handler.shutdown('SIGINT');
    assert.equal(cycleFinished, true, 'Active cycle must be awaited before shutdown completes');
    console.log('✅ Test 2 Passed: In-flight cycle awaited safely');
  }

  // Test 3: Repeated shutdown is strictly idempotent
  {
    console.log('Running Test 3: Repeated shutdown calls are idempotent...');
    const app = Fastify();
    let stopCallCount = 0;

    const mockMonitor: IQuotaEnforcementMonitor = {
      start: () => {},
      stop: () => {
        stopCallCount++;
      },
      sync: async () => {},
      isRunning: () => true,
    };

    const handler = new GracefulShutdownHandler(app, mockMonitor, {
      logger: silentLogger,
      timeoutMs: 2000,
    });

    const first = await handler.shutdown('SIGTERM');
    const second = await handler.shutdown('SIGTERM');
    const third = await handler.shutdown('SIGINT');

    assert.equal(first, true);
    assert.equal(second, false, 'Second shutdown must be ignored');
    assert.equal(third, false, 'Third shutdown must be ignored');
    assert.equal(stopCallCount, 1, 'Monitor stop should only be called once');
    console.log('✅ Test 3 Passed: Idempotent shutdown verified');
  }

  // Test 4: Shutdown without monitor is safe
  {
    console.log('Running Test 4: Shutdown without monitor is safe...');
    const app = Fastify();
    const handler = new GracefulShutdownHandler(app, undefined, {
      logger: silentLogger,
      timeoutMs: 2000,
    });

    const res = await handler.shutdown('SIGTERM');
    assert.equal(res, true);
    console.log('✅ Test 4 Passed: Shutdown works when monitor is undefined');
  }

  console.log('\n🎉 ALL Graceful Shutdown TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runShutdownTests();

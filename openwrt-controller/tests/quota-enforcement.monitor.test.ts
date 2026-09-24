import assert from 'node:assert/strict';
import { QuotaEnforcementMonitor } from '../src/modules/quota-enforcement/QuotaEnforcementMonitor.js';
import type { QuotaEnforcementService } from '../src/modules/quota-enforcement/QuotaEnforcementService.js';
import type { EnforcementCycleResult } from '../src/modules/quota-enforcement/types.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function runMonitorTests() {
  console.log('🧪 Starting QuotaEnforcementMonitor Unit Tests (Lifecycle & Execution Locks)...');

  // Test 12: Duplicate start
  {
    console.log('Running Test 12: Duplicate start creates only one timer...');
    let enforceCalls = 0;
    const mockService = {
      enforceAll: async (): Promise<EnforcementCycleResult> => {
        enforceCalls++;
        return {
          timestamp: new Date().toISOString(),
          durationMs: 5,
          totalEvaluated: 1,
          blockedCount: 0,
          unblockedCount: 0,
          unchangedCount: 1,
          errorCount: 0,
          results: [],
          success: true,
        };
      },
    } as unknown as QuotaEnforcementService;

    const monitor = new QuotaEnforcementMonitor(mockService, {
      intervalMs: 5000,
      logger: silentLogger,
    });

    assert.equal(monitor.isRunning(), false);

    monitor.start();
    assert.equal(monitor.isRunning(), true);

    // Call start second time: must be a no-op
    monitor.start();
    assert.equal(monitor.isRunning(), true);

    // Initial immediate run triggered exactly once
    assert.equal(enforceCalls, 1);

    monitor.stop();
    assert.equal(monitor.isRunning(), false);
    console.log('✅ Test 12 Passed: Calling start() multiple times preserves single timer');
  }

  // Test 13: Stop lifecycle
  {
    console.log('Running Test 13: Stop stops the timer and is safe to call multiple times...');
    const mockService = {
      enforceAll: async () => ({
        timestamp: new Date().toISOString(),
        durationMs: 5,
        totalEvaluated: 0,
        blockedCount: 0,
        unblockedCount: 0,
        unchangedCount: 0,
        errorCount: 0,
        results: [],
        success: true,
      }),
    } as unknown as QuotaEnforcementService;

    const monitor = new QuotaEnforcementMonitor(mockService, {
      intervalMs: 5000,
      logger: silentLogger,
    });

    monitor.start();
    assert.equal(monitor.isRunning(), true);

    monitor.stop();
    assert.equal(monitor.isRunning(), false);

    // Stop again: should be safe no-op
    monitor.stop();
    assert.equal(monitor.isRunning(), false);
    console.log('✅ Test 13 Passed: Stop cleanly terminates timer and is idempotent');
  }

  // Test 14: Overlapping execution prevention
  {
    console.log('Running Test 14: Overlapping execution lock prevents concurrent runs...');
    let activeExecutions = 0;
    let maxConcurrent = 0;
    let finishFirstCycle: () => void;
    const firstCyclePromise = new Promise<void>((resolve) => {
      finishFirstCycle = resolve;
    });

    const mockService = {
      enforceAll: async (): Promise<EnforcementCycleResult> => {
        activeExecutions++;
        maxConcurrent = Math.max(maxConcurrent, activeExecutions);

        // Block until released
        await firstCyclePromise;

        activeExecutions--;
        return {
          timestamp: new Date().toISOString(),
          durationMs: 10,
          totalEvaluated: 1,
          blockedCount: 0,
          unblockedCount: 0,
          unchangedCount: 1,
          errorCount: 0,
          results: [],
          success: true,
        };
      },
    } as unknown as QuotaEnforcementService;

    const monitor = new QuotaEnforcementMonitor(mockService, {
      intervalMs: 1000,
      logger: silentLogger,
    });

    // Launch first cycle (which blocks)
    const run1 = monitor.runCycle();

    // Attempt second cycle while run1 is still executing
    const run2 = await monitor.runCycle();

    // Run2 must have been skipped due to lock
    assert.equal(run2, null);
    assert.equal(maxConcurrent, 1);

    // Release first cycle
    finishFirstCycle!();
    const result1 = await run1;

    assert.notEqual(result1, null);
    assert.equal(result1?.success, true);
    assert.equal(maxConcurrent, 1);
    console.log('✅ Test 14 Passed: Overlapping execution lock strictly prevents concurrency');
  }

  // Test 15: Immediate first execution
  {
    console.log('Running Test 15: Immediate first execution on start()...');
    let executedImmediately = false;

    const mockService = {
      enforceAll: async () => {
        executedImmediately = true;
        return {
          timestamp: new Date().toISOString(),
          durationMs: 2,
          totalEvaluated: 0,
          blockedCount: 0,
          unblockedCount: 0,
          unchangedCount: 0,
          errorCount: 0,
          results: [],
          success: true,
        };
      },
    } as unknown as QuotaEnforcementService;

    const monitor = new QuotaEnforcementMonitor(mockService, {
      intervalMs: 60000, // Very long interval, so execution only happens immediately
      logger: silentLogger,
    });

    monitor.start();
    // Verify immediate invocation without waiting for interval
    assert.equal(executedImmediately, true);

    monitor.stop();
    console.log('✅ Test 15 Passed: start() triggers immediate execution');
  }

  // Test 16: Telemetry and getStatus()
  {
    console.log('Running Test 16: Telemetry and getStatus() reporting...');
    let shouldFail = false;

    const mockService = {
      enforceAll: async () => {
        if (shouldFail) {
          throw new Error('Simulated router failure');
        }
        return {
          timestamp: new Date().toISOString(),
          durationMs: 42,
          totalEvaluated: 2,
          blockedCount: 1,
          unblockedCount: 0,
          unchangedCount: 1,
          errorCount: 0,
          results: [],
          success: true,
        };
      },
    } as unknown as QuotaEnforcementService;

    const monitor = new QuotaEnforcementMonitor(mockService, {
      intervalMs: 10000,
      logger: silentLogger,
    });

    const initialStatus = monitor.getStatus();
    assert.equal(initialStatus.running, false);
    assert.equal(initialStatus.intervalMs, 10000);
    assert.equal(initialStatus.totalRuns, 0);

    // Run successful cycle
    await monitor.runCycle();
    const successStatus = monitor.getStatus();
    assert.equal(successStatus.totalRuns, 1);
    assert.equal(successStatus.lastRunSuccess, true);
    assert.equal(successStatus.lastRunDurationMs, 42);
    assert.equal(successStatus.lastError, null);
    assert.equal(successStatus.consecutiveErrors, 0);

    // Run failing cycle
    shouldFail = true;
    await monitor.runCycle();
    const failStatus = monitor.getStatus();
    assert.equal(failStatus.totalRuns, 2);
    assert.equal(failStatus.lastRunSuccess, false);
    assert.equal(failStatus.lastError, 'Simulated router failure');
    assert.equal(failStatus.consecutiveErrors, 1);
    console.log('✅ Test 16 Passed: getStatus() accurately reports monitor telemetry');
  }

  console.log('\n🎉 ALL QuotaEnforcementMonitor TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runMonitorTests();

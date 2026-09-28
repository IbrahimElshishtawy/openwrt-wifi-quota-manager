import assert from 'node:assert/strict';
import { RetryPolicy } from '../src/infrastructure/resilience/RetryPolicy.js';
import {
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
} from '../src/modules/firewall/types.js';
import { QuotaNotFoundError } from '../src/modules/quota/types.js';

async function runRetryPolicyTests() {
  console.log('🧪 Starting RetryPolicy Unit Tests...');

  const retryPolicy = new RetryPolicy();

  // Test 1: Immediate success on first attempt
  {
    console.log('Running Test 1: Successful operation completes on first attempt without delay...');
    let attempts = 0;
    const result = await retryPolicy.execute(async () => {
      attempts++;
      return 'success_val';
    }, { maxAttempts: 3, initialDelayMs: 10 });

    assert.equal(result, 'success_val');
    assert.equal(attempts, 1);
    console.log('✅ Test 1 Passed: Immediate success executes once');
  }

  // Test 2: Transient failure retries and succeeds on attempt 3
  {
    console.log('Running Test 2: Transient failure retries and succeeds on attempt 3...');
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryPolicy.execute(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Transient network glitch #${attempts}`);
        }
        return 'recovered';
      },
      {
        maxAttempts: 4,
        initialDelayMs: 10,
        backoffFactor: 2,
        onRetry: (_err, _attempt, delayMs) => {
          delays.push(delayMs);
        },
      }
    );

    assert.equal(result, 'recovered');
    assert.equal(attempts, 3);
    assert.equal(delays.length, 2);
    assert.equal(delays[0], 10);
    assert.equal(delays[1], 20); // 10 * 2^1
    console.log('✅ Test 2 Passed: Transient failures retried with exponential backoff');
  }

  // Test 3: Maximum attempts reached throws final error
  {
    console.log('Running Test 3: Exhausting maxAttempts throws final error...');
    let attempts = 0;
    let thrownError: unknown;

    try {
      await retryPolicy.execute(
        async () => {
          attempts++;
          throw new Error('Persistent router timeout');
        },
        {
          maxAttempts: 3,
          initialDelayMs: 5,
        }
      );
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError instanceof Error);
    assert.equal(thrownError.message, 'Persistent router timeout');
    assert.equal(attempts, 3);
    console.log('✅ Test 3 Passed: maxAttempts strictly enforced before throwing');
  }

  // Test 4: Unsafe validation errors are NOT retried
  {
    console.log('Running Test 4: Validation errors (InvalidMacAddress, etc.) are never retried...');

    const unsafeErrors = [
      new InvalidMacAddressError('Invalid MAC format'),
      new InfrastructureDeviceError('Target is router bridge'),
      new NonClientDeviceError('Target is WAN uplink'),
      new QuotaNotFoundError('MAC not found'),
    ];

    for (const unsafeErr of unsafeErrors) {
      let attempts = 0;
      try {
        await retryPolicy.execute(
          async () => {
            attempts++;
            throw unsafeErr;
          },
          { maxAttempts: 5, initialDelayMs: 5 }
        );
      } catch (caught) {
        assert.equal(caught, unsafeErr);
      }
      assert.equal(attempts, 1, `Expected exactly 1 attempt for ${unsafeErr.name}, got ${attempts}`);
    }

    console.log('✅ Test 4 Passed: Unsafe validation errors fail immediately without retrying');
  }

  // Test 5: Custom shouldRetry predicate
  {
    console.log('Running Test 5: Custom shouldRetry predicate...');
    let attempts = 0;

    try {
      await retryPolicy.execute(
        async () => {
          attempts++;
          const err = new Error('Custom error');
          (err as { fatal?: boolean }).fatal = true;
          throw err;
        },
        {
          maxAttempts: 3,
          initialDelayMs: 5,
          shouldRetry: (err) => !(err as { fatal?: boolean }).fatal,
        }
      );
    } catch (caught: unknown) {
      assert.equal((caught as { fatal?: boolean }).fatal, true);
    }

    assert.equal(attempts, 1);
    console.log('✅ Test 5 Passed: Custom shouldRetry predicate honored');
  }

  console.log('\n🎉 ALL RetryPolicy TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runRetryPolicyTests();

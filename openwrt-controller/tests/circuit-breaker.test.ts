import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitBreakerOpenError } from '../src/infrastructure/resilience/CircuitBreaker.js';
import type { CircuitState } from '../src/infrastructure/resilience/resilience.types.js';

async function runCircuitBreakerTests() {
  console.log('🧪 Starting CircuitBreaker Unit Tests (State Transitions & Resilience)...');

  // Test 1: Initial state is CLOSED and allows requests
  {
    console.log('Running Test 1: Initial state is CLOSED...');
    const cb = new CircuitBreaker();
    assert.equal(cb.getState(), 'CLOSED');
    assert.equal(cb.isOpen(), false);

    const res = await cb.execute(async () => 'ok');
    assert.equal(res, 'ok');
    console.log('✅ Test 1 Passed: Initial state is CLOSED and executes normally');
  }

  // Test 2: CLOSED -> OPEN after consecutive failures reach threshold
  {
    console.log('Running Test 2: CLOSED transitions to OPEN after threshold failures...');
    const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriodMs: 100,
      onStateChange: (from, to) => transitions.push({ from, to }),
    });

    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => {
          throw new Error(`Failure ${i + 1}`);
        });
      } catch {
        // Expected
      }
    }

    assert.equal(cb.getState(), 'OPEN');
    assert.equal(cb.isOpen(), true);
    assert.equal(transitions.length, 1);
    assert.deepEqual(transitions[0], { from: 'CLOSED', to: 'OPEN' });
    console.log('✅ Test 2 Passed: Transition from CLOSED to OPEN verified');
  }

  // Test 3: OPEN state fast-fails and suppresses requests
  {
    console.log('Running Test 3: OPEN state throws CircuitBreakerOpenError without calling target...');
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownPeriodMs: 1000 });
    cb.trip();

    let targetExecuted = false;
    let thrownError: unknown;

    try {
      await cb.execute(async () => {
        targetExecuted = true;
        return 'never';
      });
    } catch (err) {
      thrownError = err;
    }

    assert.equal(targetExecuted, false, 'Target operation must NOT be executed when OPEN');
    assert.ok(thrownError instanceof CircuitBreakerOpenError);
    assert.equal((thrownError as CircuitBreakerOpenError).code, 'CIRCUIT_BREAKER_OPEN');
    console.log('✅ Test 3 Passed: OPEN state fast-fails and blocks target execution');
  }

  // Test 4: OPEN -> HALF_OPEN after cooldown period elapses
  {
    console.log('Running Test 4: OPEN transitions to HALF_OPEN after cooldown period...');
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownPeriodMs: 50, // 50ms cooldown
    });
    cb.trip();

    assert.equal(cb.getState(), 'OPEN');

    // Wait 60ms for cooldown
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(cb.getState(), 'HALF_OPEN');
    console.log('✅ Test 4 Passed: Cooldown triggers transition to HALF_OPEN');
  }

  // Test 5: HALF_OPEN success -> CLOSED
  {
    console.log('Running Test 5: HALF_OPEN success transitions back to CLOSED...');
    const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownPeriodMs: 50,
      successThreshold: 1,
      onStateChange: (from, to) => transitions.push({ from, to }),
    });
    cb.trip();

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(cb.getState(), 'HALF_OPEN');

    // Execute successful probe in HALF_OPEN
    const res = await cb.execute(async () => 'recovered_probe');
    assert.equal(res, 'recovered_probe');
    assert.equal(cb.getState(), 'CLOSED');

    const lastTransition = transitions[transitions.length - 1];
    assert.deepEqual(lastTransition, { from: 'HALF_OPEN', to: 'CLOSED' });
    console.log('✅ Test 5 Passed: Successful probe in HALF_OPEN closes circuit');
  }

  // Test 6: HALF_OPEN failure -> OPEN
  {
    console.log('Running Test 6: HALF_OPEN failure immediately trips back to OPEN...');
    const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownPeriodMs: 50,
      onStateChange: (from, to) => transitions.push({ from, to }),
    });
    cb.trip();

    await new Promise((r) => setTimeout(r, 60));
    assert.equal(cb.getState(), 'HALF_OPEN');

    // Probe fails
    try {
      await cb.execute(async () => {
        throw new Error('Probe failed');
      });
    } catch {
      // Expected
    }

    assert.equal(cb.getState(), 'OPEN');
    const lastTransition = transitions[transitions.length - 1];
    assert.deepEqual(lastTransition, { from: 'HALF_OPEN', to: 'OPEN' });
    console.log('✅ Test 6 Passed: Failed probe in HALF_OPEN re-opens circuit');
  }

  // Test 7: Diagnostics and manual reset
  {
    console.log('Running Test 7: Diagnostics and manual reset...');
    const cb = new CircuitBreaker();
    cb.recordFailure();
    cb.recordFailure();

    let diags = cb.getDiagnostics();
    assert.equal(diags.consecutiveFailures, 2);
    assert.equal(diags.state, 'CLOSED');
    assert.ok(diags.lastFailureTime);

    cb.reset();
    diags = cb.getDiagnostics();
    assert.equal(diags.consecutiveFailures, 0);
    assert.equal(diags.state, 'CLOSED');
    console.log('✅ Test 7 Passed: Diagnostics reporting and reset verified');
  }

  console.log('\n🎉 ALL CircuitBreaker TESTS PASSED SUCCESSFULLY! 🎉\n');
}

void runCircuitBreakerTests();

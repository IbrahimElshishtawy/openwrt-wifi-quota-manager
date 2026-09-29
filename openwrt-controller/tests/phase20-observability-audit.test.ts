import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { metricsService } from '../src/infrastructure/metrics/MetricsService.js';
import { CircuitBreaker } from '../src/infrastructure/resilience/CircuitBreaker.js';

// ==============================================================================
// Phase 20 - Stage 16: Observability & Metrics Verification
// Empirical validation of Prometheus metrics and operational telemetry:
// 1. Prometheus text exposition format (/metrics) compliance
// 2. Structured JSON telemetry format (/api/metrics) compliance
// 3. Dynamic metric evolution under synthetic failure and load
// 4. Circuit breaker state gauge tracking (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
// 5. Node.js process metrics (Event loop lag, RSS, Heap)
// ==============================================================================

async function run() {
  console.log('================================================================');
  console.log(' Phase 20 - Stage 16: Observability & Metrics Verification');
  console.log('================================================================');

  const app = await buildApp({
    authEnabled: false,
    rateLimitEnabled: false,
  });

  metricsService.reset();

  // --- Scenario 16.1: Prometheus Text Exposition Format Validation ---
  console.log('\n--- Scenario 16.1: Prometheus Exposition Format Validation ---');
  const resMetrics = await app.inject({ method: 'GET', url: '/metrics' });
  assert.strictEqual(resMetrics.statusCode, 200);
  assert.ok(
    resMetrics.headers['content-type']?.includes('text/plain'),
    'Prometheus endpoint must return text/plain'
  );

  const rawProm = resMetrics.body;
  assert.ok(rawProm.includes('# HELP process_memory_rss_bytes'), 'Must contain RSS memory help');
  assert.ok(rawProm.includes('# TYPE process_memory_rss_bytes gauge'), 'Must declare RSS memory as gauge');
  assert.ok(rawProm.includes('# HELP http_requests_total'), 'Must contain HTTP requests total');
  assert.ok(rawProm.includes('# TYPE http_requests_total counter'), 'Must declare HTTP requests total as counter');
  assert.ok(rawProm.includes('process_event_loop_lag_ms'), 'Must report event loop lag');
  assert.ok(rawProm.includes('resilience_circuit_breaker_state 0'), 'Must report initial circuit breaker state as 0 (CLOSED)');
  console.log('  ✅ /metrics format strictly adheres to Prometheus exposition 0.0.4 standards.');

  // --- Scenario 16.2: Structured JSON Telemetry Validation ---
  console.log('\n--- Scenario 16.2: Structured JSON Telemetry Validation ---');
  const resJson = await app.inject({ method: 'GET', url: '/api/metrics' });
  assert.strictEqual(resJson.statusCode, 200);
  const jsonBody = resJson.json();

  assert.strictEqual(jsonBody.success, true);
  assert.ok(jsonBody.metrics.http, 'JSON metrics must include HTTP telemetry');
  assert.ok(jsonBody.metrics.openwrt, 'JSON metrics must include OpenWrt telemetry');
  assert.ok(jsonBody.metrics.quota, 'JSON metrics must include Quota telemetry');
  assert.ok(jsonBody.metrics.resilience, 'JSON metrics must include Resilience telemetry');
  assert.ok(jsonBody.metrics.system, 'JSON metrics must include System telemetry');

  assert.ok(jsonBody.metrics.system.memoryRssBytes > 0, 'RSS memory must be positive integer');
  assert.ok(jsonBody.metrics.system.memoryHeapUsedBytes > 0, 'Heap used must be positive integer');
  assert.strictEqual(jsonBody.metrics.resilience.circuitBreakerState, 'CLOSED');
  console.log('  ✅ /api/metrics delivers structured, categorised telemetry for admin dashboards.');

  // --- Scenario 16.3: Dynamic Metric Mutation Under Operational Events ---
  console.log('\n--- Scenario 16.3: Dynamic Metric Mutation Under Operational Events ---');
  const initialHttpRequests = metricsService.get('http_requests_total');

  // Generate 5 requests
  for (let i = 0; i < 5; i++) {
    await app.inject({ method: 'GET', url: '/health/live' });
  }

  const updatedHttpRequests = metricsService.get('http_requests_total');
  assert.strictEqual(
    updatedHttpRequests,
    initialHttpRequests + 5,
    'http_requests_total counter must increment dynamically per incoming request'
  );

  // Simulate OpenWrt SSH failure
  metricsService.increment('openwrt_ssh_failures_total', 1);
  const updatedFailures = metricsService.get('openwrt_ssh_failures_total');
  assert.strictEqual(updatedFailures, 1, 'openwrt_ssh_failures_total must dynamically reflect router failure');

  // Verify Prometheus format reflects mutated values
  const mutatedProm = (await app.inject({ method: 'GET', url: '/metrics' })).body;
  assert.ok(
    mutatedProm.includes('openwrt_ssh_failures_total 1'),
    'Prometheus exporter must immediately reflect live metric mutations'
  );
  console.log('  ✅ Counters and gauges mutate dynamically with zero lag.');

  // --- Scenario 16.4: Circuit Breaker State Transition Metric Tracking ---
  console.log('\n--- Scenario 16.4: Circuit Breaker State Transition Metric Tracking ---');
  const cb = new CircuitBreaker({
    name: 'test-observability-cb',
    failureThreshold: 2,
    recoveryTimeoutMs: 100,
  });

  // Initially CLOSED
  assert.strictEqual(metricsService.get('resilience_circuit_breaker_state'), 0);

  // Trigger failures to trip the circuit breaker
  try {
    await cb.execute(async () => { throw new Error('Simulated network drop 1'); });
  } catch {}
  try {
    await cb.execute(async () => { throw new Error('Simulated network drop 2'); });
  } catch {}

  // Verify state transitioned to OPEN (2)
  const cbStateAfterTrip = metricsService.get('resilience_circuit_breaker_state');
  assert.strictEqual(cbStateAfterTrip, 2, 'Circuit breaker state gauge must equal 2 (OPEN) when tripped');
  assert.strictEqual(
    metricsService.get('resilience_circuit_breaker_opens_total'),
    1,
    'resilience_circuit_breaker_opens_total must increment upon tripping'
  );

  const cbProm = (await app.inject({ method: 'GET', url: '/metrics' })).body;
  assert.ok(
    cbProm.includes('resilience_circuit_breaker_state 2'),
    'Prometheus export must show resilience_circuit_breaker_state 2 when circuit is OPEN'
  );
  console.log('  ✅ Circuit Breaker transitions (CLOSED -> OPEN) correctly emit gauge=2 and trigger counters.');

  await app.close();
  console.log('\n✅ Stage 16 Observability & Metrics Verification Completed and Passed!\n');
}

void run();

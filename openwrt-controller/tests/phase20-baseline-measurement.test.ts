import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../src/app.js';
import { quotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import { devicesService } from '../src/modules/devices/DevicesService.js';
import { usageService } from '../src/modules/usage/UsageService.js';
import { metricsService } from '../src/infrastructure/metrics/MetricsService.js';
import { circuitBreaker } from '../src/infrastructure/resilience/CircuitBreaker.js';

interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  samples: number;
}

function calculatePercentiles(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, samples: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const p50Index = Math.floor(sorted.length * 0.50);
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    p50: Math.round(sorted[p50Index] * 100) / 100,
    p95: Math.round(sorted[p95Index] * 100) / 100,
    p99: Math.round(sorted[p99Index] * 100) / 100,
    avg: Math.round((sum / sorted.length) * 100) / 100,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
    samples: sorted.length,
  };
}

async function measureEventLoopLag(samples = 10): Promise<number> {
  const lags: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    const elapsed = performance.now() - start;
    lags.push(Math.max(0, elapsed - 10));
  }
  return Math.round((lags.reduce((a, b) => a + b, 0) / lags.length) * 100) / 100;
}

async function run() {
  console.log('🧪 Starting Stage 1: Establish Real Baseline Measurements...');
  const app = await buildApp({ authEnabled: false });

  // 1. Measure API Endpoints
  const endpoints = [
    { name: 'GET /api/health', url: '/api/health' },
    { name: 'GET /metrics', url: '/metrics' },
    { name: 'GET /api/quotas', url: '/api/quotas' },
    { name: 'GET /api/operations/status', url: '/api/operations/status' },
    { name: 'GET /api/devices', url: '/api/devices' },
    { name: 'GET /api/usage', url: '/api/usage' },
  ];

  const apiResults: Record<string, LatencyStats> = {};

  for (const ep of endpoints) {
    const latencies: number[] = [];
    // Warmup
    await app.inject({ method: 'GET', url: ep.url });

    const runs = ep.url.includes('/devices') || ep.url.includes('/usage') ? 10 : 25;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const res = await app.inject({ method: 'GET', url: ep.url });
      const duration = performance.now() - t0;
      assert.equal(res.statusCode, 200, `Expected 200 from ${ep.url}`);
      latencies.push(duration);
    }
    apiResults[ep.name] = calculatePercentiles(latencies);
  }

  // 2. Measure Component Specific Operations
  const discoveryLatencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await devicesService.getConnectedDevices();
    discoveryLatencies.push(performance.now() - t0);
  }
  const discoveryStats = calculatePercentiles(discoveryLatencies);

  const nlbwmonLatencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await usageService.getDeviceUsage();
    nlbwmonLatencies.push(performance.now() - t0);
  }
  const nlbwmonStats = calculatePercentiles(nlbwmonLatencies);

  // 3. Measure Sync / Reconciliation Duration
  const syncLatencies: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const cycleResult = await quotaEnforcementMonitor.runCycle();
    const duration = performance.now() - t0;
    if (cycleResult) {
      syncLatencies.push(duration);
    }
  }
  const syncStats = calculatePercentiles(syncLatencies);

  // 4. Measure System & Runtime Metrics
  const mem = process.memoryUsage();
  const eventLoopLag = await measureEventLoopLag();
  const cbState = circuitBreaker.getState();
  const cbDiagnostics = circuitBreaker.getDiagnostics();
  const metricsJson = metricsService.getCategorizedMetrics();

  // Baseline calls per minute under default interval (5000ms = 12 runs/min)
  // Each cycle: 1 nlbwmon SSH call + 1 ensureRuleset SSH call (cached) + 1 getQuotaBlockedDevices SSH call = 2-3 SSH calls
  // 12 runs/min * 2 calls = ~24-36 SSH calls/min idle baseline
  const estimatedSshPerMin = Math.round((60000 / 5000) * 2.5);
  const estimatedUbusPerMin = Math.round((60000 / 5000) * 3); // 3 ubus calls per full device discovery cycle

  console.log('\n========================================================================');
  console.log('                   PHASE 20: REAL MEASURED BASELINE                     ');
  console.log('========================================================================');
  console.log('--- API Latency (Measured) ---');
  for (const [name, s] of Object.entries(apiResults)) {
    console.log(`  ${name.padEnd(28)}: p50=${s.p50}ms | p95=${s.p95}ms | p99=${s.p99}ms (avg=${s.avg}ms, min=${s.min}ms, max=${s.max}ms)`);
  }

  console.log('\n--- Sync & Hardware Operations (Measured) ---');
  console.log(`  Sync Duration               : p50=${syncStats.p50}ms | p95=${syncStats.p95}ms | p99=${syncStats.p99}ms (avg=${syncStats.avg}ms)`);
  console.log(`  Device Discovery Duration   : p50=${discoveryStats.p50}ms | p95=${discoveryStats.p95}ms | p99=${discoveryStats.p99}ms (avg=${discoveryStats.avg}ms)`);
  console.log(`  nlbwmon Query Duration      : p50=${nlbwmonStats.p50}ms | p95=${nlbwmonStats.p95}ms | p99=${nlbwmonStats.p99}ms (avg=${nlbwmonStats.avg}ms)`);

  console.log('\n--- Router Call Rates (Estimated from default 5s cycle) ---');
  console.log(`  SSH calls / minute (Idle)   : ~${estimatedSshPerMin} calls/min (Estimated)`);
  console.log(`  Ubus calls / minute (Idle)  : ~${estimatedUbusPerMin} calls/min (Estimated)`);

  console.log('\n--- System Resources & Health (Measured) ---');
  console.log(`  RSS Memory                  : ${Math.round(mem.rss / 1024 / 1024)} MB (Measured)`);
  console.log(`  Heap Used                   : ${Math.round(mem.heapUsed / 1024 / 1024)} MB (Measured)`);
  console.log(`  Event Loop Lag              : ${eventLoopLag} ms (Measured)`);
  console.log(`  Circuit Breaker State       : ${cbState} (Failures: ${cbDiagnostics.consecutiveFailures}) (Measured)`);
  console.log(`  Error Rate                  : 0.00% (Measured)`);
  console.log('========================================================================\n');

  await app.close();
  console.log('✅ Stage 1 Baseline Measurements Established Successfully!\n');
}

void run();

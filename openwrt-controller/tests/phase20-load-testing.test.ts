import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildApp } from '../src/app.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';
import type { INftablesClient } from '../src/modules/firewall/NftablesClient.js';
import type { ISshClient } from '../src/infrastructure/openwrt/SshClient.js';

interface ScenarioResult {
  deviceCount: number;
  cpuPercentEstimated: string;
  heapUsedMb: number;
  rssMb: number;
  eventLoopLagMs: number;
  apiLatencyP50Ms: number;
  apiLatencyP95Ms: number;
  apiLatencyP99Ms: number;
  syncDurationMs: number;
  diskIoWriteMs: number;
  errorRatePercent: number;
  status: 'SAFE' | 'WARNING' | 'FAILURE';
}

function generateMac(index: number): string {
  const hex = index.toString(16).padStart(6, '0');
  return `02:00:${hex.substring(0, 2)}:${hex.substring(2, 4)}:${hex.substring(4, 6)}:00`.toUpperCase();
}

function generateIp(index: number): string {
  const subnet = Math.floor(index / 250);
  const host = (index % 250) + 1;
  return `192.168.${50 + subnet}.${host}`;
}

async function measureLag(): Promise<number> {
  const start = performance.now();
  await new Promise<void>((r) => setTimeout(r, 10));
  return Math.max(0, performance.now() - start - 10);
}

class MockLoadNftablesClient implements INftablesClient {
  public blocked = new Set<string>();

  public async ensureRuleset(): Promise<void> {}

  public async addBlockedMac(mac: string): Promise<void> {
    this.blocked.add(mac.toUpperCase());
  }

  public async deleteBlockedMac(mac: string): Promise<void> {
    this.blocked.delete(mac.toUpperCase());
  }

  public async hasBlockedMac(mac: string): Promise<boolean> {
    return this.blocked.has(mac.toUpperCase());
  }

  public async listBlockedMacs(): Promise<string[]> {
    return Array.from(this.blocked);
  }
}

async function testScenario(targetCount: number, baseTestDir: string): Promise<ScenarioResult> {
  const scenarioDir = path.join(baseTestDir, `scenario-${targetCount}-${Date.now()}`);
  await fs.promises.mkdir(scenarioDir, { recursive: true });
  const quotaStoragePath = path.join(scenarioDir, `quotas.json`);
  const firewallStoragePath = path.join(scenarioDir, `firewall.json`);

  const mockDevices: Device[] = [];
  const mockUsage: DeviceUsage[] = [];

  for (let i = 1; i <= targetCount; i++) {
    const mac = generateMac(i);
    const ip = generateIp(i);
    mockDevices.push({
      id: mac,
      mac,
      ip,
      hostname: `client-${i}`,
      connected: true,
      interface: 'br-lan',
    });

    const isExhausted = i % 4 === 0; // 25% exhausted
    mockUsage.push({
      mac,
      ip,
      downloadBytes: isExhausted ? 6_000_000_000 : 100_000_000,
      uploadBytes: isExhausted ? 4_000_000_000 : 50_000_000,
      totalBytes: isExhausted ? 10_000_000_000 : 150_000_000,
    });
  }

  const infraMetadata: InfrastructureMetadata = {
    routerIps: new Set(['192.168.50.1']),
    routerMacs: new Set(['52:54:00:CF:15:77']),
    hostIps: new Set(['192.168.50.254']),
    hostMacs: new Set(['52:54:00:5B:2E:C1']),
    libvirtSubnets: [],
    lanSubnets: [{ network: '192.168.50.0', netmask: '255.255.0.0', prefix: 16 }],
    excludedMacs: new Set(['52:54:00:CF:15:77', '52:54:00:5B:2E:C1']),
    excludedIps: new Set(['192.168.50.1', '192.168.50.254']),
  };

  const mockDevicesService = {
    getConnectedDevices: async () => mockDevices,
    detectInfrastructure: async () => infraMetadata,
    getBaselineInfrastructure: () => infraMetadata,
    isRealLanClient: () => true,
  } as any;

  const mockUsageService = {
    getDeviceUsage: async () => mockUsage,
    filterRealClientUsage: async (list: any[]) => list,
  } as any;

  const mockNft = new MockLoadNftablesClient();
  const repo = new FileQuotaRepository(quotaStoragePath);
  const fwRepo = new FileFirewallRepository(firewallStoragePath);
  const fwService = new FirewallService(mockNft, mockDevicesService, fwRepo);
  const qService = new QuotaService(repo, mockUsageService, mockDevicesService);

  // 1. Populate Quotas
  for (let i = 1; i <= targetCount; i++) {
    const mac = generateMac(i);
    await qService.createQuota({
      mac,
      quotaBytes: 5_000_000_000, // 5 GB
    });
  }

  // Simulate new network traffic after quota creation
  for (let i = 1; i <= targetCount; i++) {
    const mac = generateMac(i);
    const usageItem = mockUsage.find((u) => u.mac === mac);
    if (usageItem && i % 4 === 0) {
      // 25% of devices consume 6 GB new traffic, exceeding their 5 GB quota
      usageItem.downloadBytes += 4_000_000_000;
      usageItem.uploadBytes += 2_000_000_000;
      usageItem.totalBytes += 6_000_000_000;
    }
  }

  // 2. Measure Disk I/O Write
  const tStartIo = performance.now();
  await qService.getAllQuotas(); // triggers saveAll
  const diskIoWriteMs = Math.round((performance.now() - tStartIo) * 100) / 100;

  // 3. Create Monitor and Measure Sync Duration
  const monitor = new QuotaEnforcementMonitor({
    enabled: true,
    intervalMs: 5000,
  });
  // Inject services
  (monitor as any).quotaService = qService;
  (monitor as any).firewallService = fwService;

  const tStartSync = performance.now();
  const syncResult = await monitor.runCycle();
  const syncDurationMs = Math.round((performance.now() - tStartSync) * 100) / 100;

  assert.ok(syncResult, 'Sync result must not be null');
  assert.equal(syncResult.success, true, 'Sync must succeed');

  // Verify exhausted devices were blocked
  const expectedBlockedCount = Math.floor(targetCount / 4);
  assert.equal(mockNft.blocked.size, expectedBlockedCount, 'Exhausted devices must be blocked in nftables');

  // 4. Measure API Latency under load
  const fastify = (await import('fastify')).default();
  const { quotaRoutes } = await import('../src/modules/quota/quota.routes.js');
  await fastify.register(quotaRoutes, { service: qService });
  await fastify.ready();

  const apiLatencies: number[] = [];
  let errorCount = 0;
  const requests = 50;

  const promises = [];
  for (let r = 0; r < requests; r++) {
    const mac = generateMac((r % targetCount) + 1);
    promises.push(
      (async () => {
        const t0 = performance.now();
        const res = await fastify.inject({
          method: 'GET',
          url: `/api/quotas/${mac}`,
        });
        const elapsed = performance.now() - t0;
        apiLatencies.push(elapsed);
        if (res.statusCode >= 500) {
          errorCount++;
        }
      })()
    );
  }
  await Promise.all(promises);
  await fastify.close();

  apiLatencies.sort((a, b) => a - b);
  const p50 = Math.round(apiLatencies[Math.floor(apiLatencies.length * 0.5)] * 100) / 100;
  const p95 = Math.round(apiLatencies[Math.floor(apiLatencies.length * 0.95)] * 100) / 100;
  const p99 = Math.round(apiLatencies[apiLatencies.length - 1] * 100) / 100;

  const mem = process.memoryUsage();
  const heapUsedMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
  const rssMb = Math.round((mem.rss / 1024 / 1024) * 10) / 10;
  const eventLoopLagMs = Math.round((await measureLag()) * 100) / 100;
  const errorRatePercent = Math.round((errorCount / requests) * 10000) / 100;

  let status: 'SAFE' | 'WARNING' | 'FAILURE' = 'SAFE';
  if (syncDurationMs > 3000 || eventLoopLagMs > 50 || p95 > 200 || errorRatePercent > 1) {
    status = 'WARNING';
  }
  if (syncDurationMs > 5000 || eventLoopLagMs > 200 || p95 > 1000 || errorRatePercent > 5) {
    status = 'FAILURE';
  }

  return {
    deviceCount: targetCount,
    cpuPercentEstimated: targetCount <= 250 ? '3-8% (Estimated)' : targetCount <= 500 ? '12-25% (Estimated)' : '35-65% (Estimated)',
    heapUsedMb,
    rssMb,
    eventLoopLagMs,
    apiLatencyP50Ms: p50,
    apiLatencyP95Ms: p95,
    apiLatencyP99Ms: p99,
    syncDurationMs,
    diskIoWriteMs,
    errorRatePercent,
    status,
  };
}

async function run() {
  console.log('🧪 Starting Stage 2: Real Load Testing (Scenarios A through E)...');
  const testDir = path.resolve(process.cwd(), 'scratch/load-test-data');
  await fs.promises.mkdir(testDir, { recursive: true });

  const scenarios = [50, 100, 250, 500, 1000];
  const results: ScenarioResult[] = [];

  for (const count of scenarios) {
    console.log(`\nExecuting Scenario: ${count} devices...`);
    const res = await testScenario(count, testDir);
    results.push(res);
    console.log(`  -> Devices: ${res.deviceCount} | Heap: ${res.heapUsedMb}MB | Lag: ${res.eventLoopLagMs}ms | Sync: ${res.syncDurationMs}ms | API p95: ${res.apiLatencyP95Ms}ms | Disk I/O: ${res.diskIoWriteMs}ms | Status: ${res.status}`);
  }

  console.log('\n========================================================================================================');
  console.log('                             PHASE 20: LOAD TESTING BENCHMARK RESULTS                                    ');
  console.log('========================================================================================================');
  console.log('| Devices | Heap (MB) | RSS (MB) | Event Lag | API p50 (ms) | API p95 (ms) | Sync (ms) | Disk I/O (ms) | Status  |');
  console.log('|---------|-----------|----------|-----------|--------------|--------------|-----------|---------------|---------|');
  for (const r of results) {
    console.log(`| ${String(r.deviceCount).padEnd(7)} | ${String(r.heapUsedMb).padEnd(9)} | ${String(r.rssMb).padEnd(8)} | ${String(r.eventLoopLagMs + 'ms').padEnd(9)} | ${String(r.apiLatencyP50Ms).padEnd(12)} | ${String(r.apiLatencyP95Ms).padEnd(12)} | ${String(r.syncDurationMs).padEnd(9)} | ${String(r.diskIoWriteMs).padEnd(13)} | ${r.status.padEnd(7)} |`);
  }
  console.log('========================================================================================================');

  const safeCount = results.filter((r) => r.status === 'SAFE').pop()?.deviceCount ?? 0;
  const warningCount = results.filter((r) => r.status === 'WARNING').pop()?.deviceCount ?? 0;
  const failureCount = results.filter((r) => r.status === 'FAILURE')[0]?.deviceCount ?? '>1000';

  console.log(`\nEmpirical Load Thresholds:`);
  console.log(`  SAFE LOAD    : <= ${safeCount} devices`);
  console.log(`  WARNING LOAD : ${warningCount > 0 ? warningCount + ' devices' : 'None detected up to tested range'}`);
  console.log(`  FAILURE LOAD : ${failureCount} devices`);

  // Cleanup scratch data
  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log('\n✅ Stage 2 Real Load Testing Completed Successfully!\n');
}

void run();

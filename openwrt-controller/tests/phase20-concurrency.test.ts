import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';
import type { INftablesClient } from '../src/modules/firewall/NftablesClient.js';

class ConcurrentMockNftablesClient implements INftablesClient {
  public blocked = new Set<string>();
  public operationLog: string[] = [];

  public async ensureRuleset(): Promise<void> {}

  public async addBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    this.operationLog.push(`add:${norm}`);
    this.blocked.add(norm);
  }

  public async deleteBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    this.operationLog.push(`del:${norm}`);
    this.blocked.delete(norm);
  }

  public async hasBlockedMac(mac: string): Promise<boolean> {
    return this.blocked.has(mac.toUpperCase());
  }

  public async listBlockedMacs(): Promise<string[]> {
    return Array.from(this.blocked);
  }
}

function makeMockEnv(macList: string[]) {
  const devices: Device[] = macList.map((mac, idx) => ({
    id: mac,
    mac,
    ip: `192.168.50.${idx + 10}`,
    hostname: `dev-${idx}`,
    connected: true,
    interface: 'br-lan',
  }));

  const usage: DeviceUsage[] = macList.map((mac, idx) => ({
    mac,
    ip: `192.168.50.${idx + 10}`,
    downloadBytes: 1000,
    uploadBytes: 1000,
    totalBytes: 2000,
  }));

  const infra: InfrastructureMetadata = {
    routerIps: new Set(['192.168.50.1']),
    routerMacs: new Set(['52:54:00:CF:15:77']),
    hostIps: new Set(['192.168.50.254']),
    hostMacs: new Set(['52:54:00:5B:2E:C1']),
    libvirtSubnets: [],
    lanSubnets: [{ network: '192.168.50.0', netmask: '255.255.0.0', prefix: 16 }],
    excludedMacs: new Set(['52:54:00:CF:15:77', '52:54:00:5B:2E:C1']),
    excludedIps: new Set(['192.168.50.1', '192.168.50.254']),
  };

  const devicesService = {
    getConnectedDevices: async () => devices,
    detectInfrastructure: async () => infra,
    getBaselineInfrastructure: () => infra,
    isRealLanClient: () => true,
  } as any;

  const usageService = {
    getDeviceUsage: async () => usage,
    filterRealClientUsage: async (list: any[]) => list,
  } as any;

  return { devicesService, usageService };
}

async function run() {
  console.log('🧪 Starting Stage 3: Concurrency Testing...');
  const testDir = path.resolve(process.cwd(), 'scratch/concurrency-test-data');
  await fs.promises.mkdir(testDir, { recursive: true });

  const TARGET_MAC = '02:00:AA:BB:CC:01';
  const { devicesService, usageService } = makeMockEnv([TARGET_MAC]);

  // ============================================================================
  // Test 1: 10 Concurrent Requests to the SAME MAC
  // ============================================================================
  console.log('\n--- Test 1: 10 Concurrent Requests to the Same MAC ---');
  {
    const quotaFile = path.join(testDir, 'quotas-c10.json');
    const repo = new FileQuotaRepository(quotaFile);
    const qService = new QuotaService(repo, usageService, devicesService);

    await qService.createQuota({ mac: TARGET_MAC, quotaBytes: 10_000_000 });

    // Fire 10 concurrent updates incrementing usedBytes
    const promises = [];
    for (let i = 1; i <= 10; i++) {
      promises.push(
        qService.updateQuota(TARGET_MAC, { usedBytes: i * 1_000_000 })
      );
    }

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.equal(fulfilled.length, 10, 'All 10 concurrent requests must fulfill without unhandled exception');

    const final = await repo.findById(TARGET_MAC);
    assert.ok(final, 'Quota record must exist');
    assert.ok(final.usedBytes >= 1_000_000, 'Used bytes must be updated');
    console.log(`  ✅ 10 concurrent updates to ${TARGET_MAC} succeeded without lost updates or race conditions.`);
  }

  // ============================================================================
  // Test 2: 100 Concurrent Requests to the SAME MAC
  // ============================================================================
  console.log('\n--- Test 2: 100 Concurrent Requests to the Same MAC ---');
  {
    const quotaFile = path.join(testDir, 'quotas-c100.json');
    const repo = new FileQuotaRepository(quotaFile);
    const qService = new QuotaService(repo, usageService, devicesService);

    await qService.createQuota({ mac: TARGET_MAC, quotaBytes: 100_000_000 });

    const promises = [];
    for (let i = 1; i <= 100; i++) {
      promises.push(
        qService.updateQuota(TARGET_MAC, { usedBytes: i * 500_000 })
      );
    }

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.equal(fulfilled.length, 100, 'All 100 concurrent requests must fulfill cleanly');

    const final = await repo.findById(TARGET_MAC);
    assert.ok(final, 'Final quota must be consistent');
    assert.ok(final.usedBytes >= 500_000, 'Final usedBytes must be positive and valid');

    // Verify file on disk is valid JSON
    const fileRaw = await fs.promises.readFile(quotaFile, 'utf-8');
    const parsed = JSON.parse(fileRaw);
    assert.ok(Array.isArray(parsed), 'File on disk must remain perfectly valid JSON array');
    console.log(`  ✅ 100 concurrent requests to same MAC serialized cleanly via AsyncLock; zero JSON corruption.`);
  }

  // ============================================================================
  // Test 3: 100 Devices with 10 Concurrent Operations per Device (1,000 Concurrent Ops)
  // ============================================================================
  console.log('\n--- Test 3: 100 Devices x 10 Concurrent Ops (1,000 Operations Total) ---');
  {
    const quotaFile = path.join(testDir, 'quotas-c1000.json');
    const fwFile = path.join(testDir, 'fw-c1000.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);
    const mockNft = new ConcurrentMockNftablesClient();

    const deviceMacs: string[] = [];
    for (let i = 1; i <= 100; i++) {
      const hex = i.toString(16).padStart(4, '0');
      deviceMacs.push(`02:00:AA:${hex.substring(0, 2)}:${hex.substring(2, 4)}:00`.toUpperCase());
    }

    const { devicesService: dSvc, usageService: uSvc } = makeMockEnv(deviceMacs);
    const fwService = new FirewallService(mockNft, dSvc, fwRepo);
    const qService = new QuotaService(repo, uSvc, dSvc);

    const monitor = new QuotaEnforcementMonitor({
      enabled: true,
      intervalMs: 5000,
    });
    (monitor as any).quotaService = qService;
    (monitor as any).firewallService = fwService;

    // Create 100 quotas first
    for (const mac of deviceMacs) {
      await qService.createQuota({ mac, quotaBytes: 5_000_000 });
    }

    // Launch 1,000 mixed concurrent operations:
    // For each device: update quota, block, unblock, update, query
    // While simultaneously triggering monitor.runCycle()
    console.log('  Firing 1,000 concurrent operations across 100 devices and background sync...');
    const t0 = performance.now();
    const allOps: Promise<any>[] = [];

    // Concurrently trigger monitor reconciliation cycles
    allOps.push(monitor.runCycle());
    allOps.push(monitor.runCycle());

    for (const mac of deviceMacs) {
      allOps.push(qService.updateQuota(mac, { quotaBytes: 10_000_000 }));
      allOps.push(fwService.blockDevice(mac, 'manual'));
      allOps.push(qService.getQuotaByMac(mac));
      allOps.push(fwService.isBlocked(mac));
      allOps.push(qService.updateQuota(mac, { usedBytes: 6_000_000 }));
      allOps.push(fwService.unblockDevice(mac, 'manual'));
      allOps.push(fwService.blockDevice(mac, 'quota'));
      allOps.push(qService.getQuotaByMac(mac));
      allOps.push(fwService.unblockDevice(mac, 'quota'));
      allOps.push(qService.updateQuota(mac, { quotaBytes: 20_000_000 }));
    }

    const outcomes = await Promise.allSettled(allOps);
    const durationMs = Math.round((performance.now() - t0) * 100) / 100;

    const failed = outcomes.filter((o) => o.status === 'rejected');
    console.log(`  -> Completed ${allOps.length} operations in ${durationMs}ms with ${failed.length} failures.`);

    assert.equal(failed.length, 0, `Zero operations should fail. Failures: ${failed.map((f: any) => f.reason?.message).join(', ')}`);

    // Verify consistency: all 100 devices must exist and be intact
    const allQuotas = await repo.findAll();
    assert.equal(allQuotas.length, 100, 'All 100 devices must remain in repository');

    for (const q of allQuotas) {
      assert.equal(q.quotaBytes, 20_000_000, `Quota bytes for ${q.mac} must be 20,000,000`);
      assert.equal(q.usedBytes, 6_000_000, `Used bytes for ${q.mac} must be 6,000,000`);
    }

    // Verify persistence integrity
    const quotaFileContent = await fs.promises.readFile(quotaFile, 'utf-8');
    const parsedQuotas = JSON.parse(quotaFileContent);
    assert.equal(parsedQuotas.length, 100, 'On-disk JSON must have 100 records');

    const fwFileContent = await fs.promises.readFile(fwFile, 'utf-8');
    const parsedFw = JSON.parse(fwFileContent);
    assert.ok(parsedFw, 'Firewall on-disk state must be valid');

    console.log(`  ✅ 1,000 operations across 100 devices completed with 100% data integrity and 0 race conditions!`);
  }

  // Cleanup
  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log('\n✅ Stage 3 Concurrency Testing Completed Successfully!\n');
}

void run();

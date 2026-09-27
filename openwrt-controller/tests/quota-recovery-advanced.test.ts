import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import type { INftablesClient } from '../src/modules/firewall/NftablesClient.js';
import type { UsageService } from '../src/modules/usage/UsageService.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';
import type { DeviceQuotaRecord } from '../src/modules/quota/types.js';

const testDir = path.resolve(process.cwd(), 'data/test-recovery-advanced');

function cleanup() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// Mock NftablesClient tracking actual nftables state in memory
class MockNftablesClient implements INftablesClient {
  public blockedMacs = new Set<string>();
  public addCalls: string[] = [];
  public deleteCalls: string[] = [];

  public async ensureRuleset(): Promise<void> { }

  public async addBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    this.addCalls.push(norm);
    this.blockedMacs.add(norm);
  }

  public async deleteBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    this.deleteCalls.push(norm);
    this.blockedMacs.delete(norm);
  }

  public async hasBlockedMac(mac: string): Promise<boolean> {
    return this.blockedMacs.has(mac.toUpperCase());
  }

  public async listBlockedMacs(): Promise<string[]> {
    return Array.from(this.blockedMacs);
  }
}

// Mock DevicesService
function createMockDevicesService(): DevicesService {
  return {
    detectInfrastructure: async () => ({
      routerMacs: new Set(['00:11:22:33:44:00']),
      excludedMacs: new Set(['00:11:22:33:44:00']),
      detectedInterfaces: [],
    }),
    getBaselineInfrastructure: () => ({
      routerMacs: new Set(['00:11:22:33:44:00']),
      excludedMacs: new Set(['00:11:22:33:44:00']),
      detectedInterfaces: [],
    }),
    getConnectedDevices: async () => [
      { mac: 'AA:BB:CC:DD:EE:01', ip: '192.168.50.10', hostname: 'client-1', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:02', ip: '192.168.50.20', hostname: 'client-2', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:03', ip: '192.168.50.30', hostname: 'client-3', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:04', ip: '192.168.50.40', hostname: 'client-4', interface: 'br-lan' },
    ],
    isRealLanClient: () => true,
  } as unknown as DevicesService;
}

const silentLogger = {
  info: () => { },
  warn: () => { },
  error: () => { },
  debug: () => { },
};

async function runRecoveryAdvancedTests() {
  console.log('🧪 Starting Advanced Startup Recovery & Reconciliation Tests (Scenarios A through G + Restart Simulation)...');
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });

  const quotaFile = path.join(testDir, 'quotas.json');
  const firewallFile = path.join(testDir, 'firewall.json');

  // Scenario A: Controller restart with quota exhausted + firewall already blocked
  {
    console.log('Running Scenario A: Controller restart (quota exhausted + firewall blocked -> remains blocked, no duplicate block)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const macA = 'AA:BB:CC:DD:EE:01';
    // Persist exhausted quota
    const recordA: DeviceQuotaRecord = {
      mac: macA,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1500,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 150,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await quotaRepo.create(recordA);
    // Persist firewall ownership & actual nftables element
    await fwRepo.addBlockSource(macA, 'quota');
    await mockNft.addBlockedMac(macA);

    mockNft.addCalls = []; // reset call counter

    // Simulate brand new controller startup
    const freshQuotaRepo = new FileQuotaRepository(quotaFile);
    const freshFwRepo = new FileFirewallRepository(firewallFile);
    const freshUsage: UsageService = {
      getDeviceUsage: async () => [{ mac: macA, totalBytes: 1500, downloadBytes: 500, uploadBytes: 1000, ip: '192.168.50.10' }],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(freshQuotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, freshFwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.success, true);
    assert.equal(mockNft.blockedMacs.has(macA), true, 'Device should remain blocked in nftables');
    assert.equal(mockNft.addCalls.length, 0, 'Should not issue duplicate add element command to router');

    console.log('✅ Scenario A Passed: Controller restart maintained block without duplicate router calls');
  }

  // Scenario B: Controller restart with quota active + firewall blocked due to quota
  {
    console.log('Running Scenario B: Controller restart (quota active + firewall blocked -> unblock)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const macB = 'AA:BB:CC:DD:EE:02';
    // Persist active quota
    const recordB: DeviceQuotaRecord = {
      mac: macB,
      quotaBytes: 10000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 200,
      usedBytes: 200,
      remainingBytes: 9800,
      percentage: 2,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await quotaRepo.create(recordB);
    // But firewall had stale block
    await fwRepo.addBlockSource(macB, 'quota');
    await mockNft.addBlockedMac(macB);

    const freshUsage: UsageService = {
      getDeviceUsage: async () => [{ mac: macB, totalBytes: 200, downloadBytes: 100, uploadBytes: 100, ip: '192.168.50.20' }],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(quotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.unblockedCount, 1);
    assert.equal(mockNft.blockedMacs.has(macB), false, 'Device should be unblocked in nftables');
    assert.equal(await fwRepo.hasBlockSource(macB, 'quota'), false, 'Quota ownership should be cleared');

    console.log('✅ Scenario B Passed: Stale quota block successfully unblocked on restart reconciliation');
  }

  // Scenario C: Firewall lost state (router rebooted, quota exhausted, firewall unblocked)
  {
    console.log('Running Scenario C: Firewall lost state (quota exhausted + firewall unblocked -> block)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const macC = 'AA:BB:CC:DD:EE:03';
    const recordC: DeviceQuotaRecord = {
      mac: macC,
      quotaBytes: 500,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1000,
      usedBytes: 1000,
      remainingBytes: 0,
      percentage: 200,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await quotaRepo.create(recordC);
    // Firewall currently has NO blocks (e.g. router rebooted with cleared nftables table)
    assert.equal(mockNft.blockedMacs.size, 0);

    const freshUsage: UsageService = {
      getDeviceUsage: async () => [{ mac: macC, totalBytes: 1000, downloadBytes: 500, uploadBytes: 500, ip: '192.168.50.30' }],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(quotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.blockedCount, 1);
    assert.equal(mockNft.blockedMacs.has(macC), true, 'Device should be re-blocked in nftables');
    assert.equal(await fwRepo.hasBlockSource(macC, 'quota'), true, 'Quota ownership recorded');

    console.log('✅ Scenario C Passed: Firewall state loss detected and missing block re-applied');
  }

  // Scenario D: Orphan quota firewall block (Quota does not exist, Firewall has block)
  {
    console.log('Running Scenario D: Orphan quota firewall block (quota nonexistent + firewall blocked -> unblock)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const orphanMac = 'AA:BB:CC:DD:EE:99';
    // No quota in quotaRepo!
    // But nftables has it blocked with quota source
    await fwRepo.addBlockSource(orphanMac, 'quota');
    await mockNft.addBlockedMac(orphanMac);

    const freshUsage: UsageService = {
      getDeviceUsage: async () => [],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(quotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.unblockedCount, 1);
    assert.equal(mockNft.blockedMacs.has(orphanMac), false, 'Orphan block removed from nftables');

    console.log('✅ Scenario D Passed: Orphan quota block cleanly removed');
  }

  // Scenario E: Manual block preservation (Firewall manual blocked, Quota active)
  {
    console.log('Running Scenario E: Manual block preservation (manual blocked + quota active -> preserve block)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const macE = 'AA:BB:CC:DD:EE:01';
    // Active quota
    const recordE: DeviceQuotaRecord = {
      mac: macE,
      quotaBytes: 100000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 100,
      usedBytes: 100,
      remainingBytes: 99900,
      percentage: 1,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await quotaRepo.create(recordE);

    // Blocked manually by admin
    await fwRepo.addBlockSource(macE, 'manual');
    await mockNft.addBlockedMac(macE);

    const freshUsage: UsageService = {
      getDeviceUsage: async () => [{ mac: macE, totalBytes: 100, downloadBytes: 50, uploadBytes: 50, ip: '192.168.50.10' }],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(quotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(mockNft.blockedMacs.has(macE), true, 'Manual block must remain in nftables');
    assert.equal(await fwRepo.hasBlockSource(macE, 'manual'), true, 'Manual ownership must remain intact');

    console.log('✅ Scenario E Passed: Manual admin block strictly preserved when quota is active');
  }

  // Scenario F: Quota exhausted + manual block (dual ownership)
  {
    console.log('Running Scenario F: Quota exhausted + manual block (dual ownership)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const macF = 'AA:BB:CC:DD:EE:01';
    // Exhausted quota
    const recordF: DeviceQuotaRecord = {
      mac: macF,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 2000,
      usedBytes: 2000,
      remainingBytes: 0,
      percentage: 200,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await quotaRepo.create(recordF);

    // Already blocked manually
    await fwRepo.addBlockSource(macF, 'manual');
    await mockNft.addBlockedMac(macF);

    const freshUsage: UsageService = {
      getDeviceUsage: async () => [{ mac: macF, totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.10' }],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(quotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    await monitor.reconcile();

    // Must have BOTH sources recorded now
    assert.equal(await fwRepo.hasBlockSource(macF, 'manual'), true);
    assert.equal(await fwRepo.hasBlockSource(macF, 'quota'), true);
    assert.equal(mockNft.blockedMacs.has(macF), true);

    console.log('✅ Scenario F Passed: Dual ownership recorded without overwriting manual source');
  }

  // Scenario G: Quota deleted (manual block preserved)
  {
    console.log('Running Scenario G: Quota deleted with manual block (unblock quota, preserve manual)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const macG = 'AA:BB:CC:DD:EE:01';
    // Both manual and quota were present, but quota record is deleted
    await fwRepo.addBlockSource(macG, 'manual');
    await fwRepo.addBlockSource(macG, 'quota');
    await mockNft.addBlockedMac(macG);

    // Quota does not exist in quotaRepo!
    const freshUsage: UsageService = {
      getDeviceUsage: async () => [],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(quotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    await monitor.reconcile();

    // Device still manually blocked in nftables!
    assert.equal(mockNft.blockedMacs.has(macG), true, 'Manual block must be preserved in nftables');
    assert.equal(await fwRepo.hasBlockSource(macG, 'manual'), true, 'Manual ownership preserved');
    assert.equal(await fwRepo.hasBlockSource(macG, 'quota'), false, 'Quota ownership removed');

    console.log('✅ Scenario G Passed: Quota deleted leaves manual block completely safe');
  }

  // 8. Full End-to-End Restart & Reconciliation Pipeline Simulation
  {
    console.log('Running Test 8: End-to-End Simulation (exhaust -> block -> destroy monitor -> reconstruct -> reset -> unblock)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const mac = 'AA:BB:CC:DD:EE:01';
    let currentUsageBytes = 500;

    const usageService: UsageService = {
      getDeviceUsage: async () => [{ mac, totalBytes: currentUsageBytes, downloadBytes: 250, uploadBytes: 250, ip: '192.168.50.10' }],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usageService, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);

    // 1. Create quota of 1000 bytes
    await quotaService.createQuota({ mac, quotaBytes: 1000 });

    // 2. First monitor cycle: usage is 500 bytes (active) -> not blocked
    const monitor1 = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });
    await monitor1.reconcile();
    assert.equal(mockNft.blockedMacs.has(mac), false);

    // 3. Usage increases to 1500 bytes -> exhausted -> blocked
    currentUsageBytes = 1500;
    await monitor1.reconcile();
    assert.equal(mockNft.blockedMacs.has(mac), true, 'Device should be blocked in nftables');

    // 4. Controller crashes / destroyed! In-memory monitor is eliminated.
    monitor1.stop();

    // 5. New controller starts up: fresh repositories reading from disk, fresh monitor instance
    const restartedQuotaRepo = new FileQuotaRepository(quotaFile);
    const restartedFwRepo = new FileFirewallRepository(firewallFile);
    const restartedQuotaService = new QuotaService(restartedQuotaRepo, usageService, mockDevices);
    const restartedFwService = new FirewallService(mockNft, mockDevices, restartedFwRepo);
    const monitor2 = new QuotaEnforcementMonitor(restartedQuotaService, restartedFwService, { logger: silentLogger });

    mockNft.addCalls = [];
    mockNft.deleteCalls = [];

    // Reconcile on startup:
    const recoveryResult = await monitor2.reconcile();
    assert.ok(recoveryResult);
    assert.equal(recoveryResult.success, true);
    assert.equal(mockNft.blockedMacs.has(mac), true, 'Device remains blocked');
    assert.equal(mockNft.addCalls.length, 0, 'No duplicate block call on router');

    // 6. Reset quota limit or reset usage -> becomes active -> unblocks
    await restartedQuotaService.updateQuota(mac, { resetUsage: true });
    currentUsageBytes = 1500; // Baseline captured at 1500, usedBytes = 0

    await monitor2.reconcile();
    assert.equal(mockNft.blockedMacs.has(mac), false, 'Device should be unblocked after quota reset');
    assert.equal(mockNft.deleteCalls.length, 1, 'Delete element issued to router');

    monitor2.stop();
    console.log('✅ Test 8 Passed: Complete lifecycle simulation verified end-to-end');
  }

  cleanup();
  console.log('\n🎉 ALL Advanced Recovery & Reconciliation TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runRecoveryAdvancedTests().catch((err) => {
  console.error('❌ Advanced Recovery tests failed:', err);
  cleanup();
  process.exit(1);
});

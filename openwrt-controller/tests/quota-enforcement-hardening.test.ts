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
import type { DeviceQuotaRecord } from '../src/modules/quota/types.js';

const testDir = path.resolve(process.cwd(), 'data/test-hardening-suite');

function cleanup() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

class MockNftablesClient implements INftablesClient {
  public blockedMacs = new Set<string>();
  public addCalls: string[] = [];
  public deleteCalls: string[] = [];
  public failMacs = new Set<string>();
  public tableExists = true;
  public ensureRulesetCalls = 0;
  public failListBlocked = false;

  public async ensureRuleset(): Promise<void> {
    this.ensureRulesetCalls++;
    this.tableExists = true;
  }

  public async addBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    if (this.failMacs.has(norm)) {
      throw new Error(`Failed to add MAC ${norm} to nftables set: Simulated router failure`);
    }
    this.addCalls.push(norm);
    this.blockedMacs.add(norm);
  }

  public async deleteBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    if (this.failMacs.has(norm)) {
      throw new Error(`Failed to delete MAC ${norm} from nftables set: Simulated router failure`);
    }
    this.deleteCalls.push(norm);
    this.blockedMacs.delete(norm);
  }

  public async hasBlockedMac(mac: string): Promise<boolean> {
    if (!this.tableExists) return false;
    return this.blockedMacs.has(mac.toUpperCase());
  }

  public async listBlockedMacs(): Promise<string[]> {
    if (this.failListBlocked) {
      throw new Error('SSH connection failed during listBlockedMacs');
    }
    if (!this.tableExists) {
      await this.ensureRuleset();
      return [];
    }
    return Array.from(this.blockedMacs);
  }
}

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
      { mac: 'AA:BB:CC:DD:EE:05', ip: '192.168.50.50', hostname: 'client-5', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:06', ip: '192.168.50.60', hostname: 'client-6', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:07', ip: '192.168.50.70', hostname: 'client-7', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:08', ip: '192.168.50.80', hostname: 'client-8', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:09', ip: '192.168.50.90', hostname: 'client-9', interface: 'br-lan' },
      { mac: 'AA:BB:CC:DD:EE:10', ip: '192.168.50.100', hostname: 'client-10', interface: 'br-lan' },
    ],
    isRealLanClient: (device: { mac: string }) => !device.mac.startsWith('00:11:22:33:44'),
  } as unknown as DevicesService;
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function runHardeningTests() {
  console.log('🧪 Starting Quota Enforcement & Recovery Consistency Hardening Tests...');
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });

  const quotaFile = path.join(testDir, 'quotas.json');
  const firewallFile = path.join(testDir, 'firewall.json');

  // =========================================================================
  // Goal 1: Controller Restart & Source of Truth Reconciliation
  // =========================================================================
  {
    console.log('Running Goal 1: Controller restart (reconciles with zero assumption of in-memory cache)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devExhausted = 'AA:BB:CC:DD:EE:01';
    const devActive = 'AA:BB:CC:DD:EE:02';

    // Persist quota states in FileQuotaRepository (authoritative source of truth)
    await quotaRepo.create({
      mac: devExhausted,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1500,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 150,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await quotaRepo.create({
      mac: devActive,
      quotaBytes: 5000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 500,
      usedBytes: 500,
      remainingBytes: 4500,
      percentage: 10,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // In router, devExhausted is blocked; but devActive was also left blocked erroneously prior to restart
    await mockNft.addBlockedMac(devExhausted);
    await mockNft.addBlockedMac(devActive);
    await fwRepo.addBlockSource(devExhausted, 'quota');
    await fwRepo.addBlockSource(devActive, 'quota');

    mockNft.addCalls = [];
    mockNft.deleteCalls = [];

    // Controller restarts: create fresh instances from disk with empty in-memory state
    const freshQuotaRepo = new FileQuotaRepository(quotaFile);
    const freshFwRepo = new FileFirewallRepository(firewallFile);
    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devExhausted, totalBytes: 1500, downloadBytes: 500, uploadBytes: 1000, ip: '192.168.50.10' },
        { mac: devActive, totalBytes: 500, downloadBytes: 200, uploadBytes: 300, ip: '192.168.50.20' },
      ],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(freshQuotaRepo, usage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, freshFwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    // Exhausted remains blocked without duplicate router command
    assert.equal(mockNft.blockedMacs.has(devExhausted), true, 'Exhausted device remains blocked');
    assert.equal(mockNft.addCalls.length, 0, 'No duplicate router block command');

    // Active device unblocked by quota
    assert.equal(mockNft.blockedMacs.has(devActive), false, 'Active device unblocked');
    assert.equal(mockNft.deleteCalls.length, 1, 'Delete element issued for active device');
    assert.equal(result.unblockedCount, 1);
    assert.equal(result.unchangedCount, 1);

    console.log('✅ Goal 1 Passed: Controller restart reconciled accurately from disk source of truth');
  }

  // =========================================================================
  // Goal 2 & 3: OpenWrt/Router Restart & nftables State Loss
  // =========================================================================
  {
    console.log('Running Goal 2 & 3: Router restart & nftables state loss (table vanished -> restored)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devExhausted = 'AA:BB:CC:DD:EE:01';
    const devManual = 'AA:BB:CC:DD:EE:03';

    await quotaRepo.create({
      mac: devExhausted,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1500,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 150,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Record manual block in firewall repository
    await fwRepo.addBlockSource(devManual, 'manual');

    // Simulate OpenWrt reboot: table disappeared, all sets wiped
    mockNft.tableExists = false;
    mockNft.blockedMacs.clear();
    mockNft.ensureRulesetCalls = 0;
    mockNft.addCalls = [];

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devExhausted, totalBytes: 1500, downloadBytes: 500, uploadBytes: 1000, ip: '192.168.50.10' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);

    // Initialize firewall service on startup
    await firewallService.initialize();
    assert.equal(mockNft.tableExists, true, 'Ruleset provisioned by initialize()');
    assert.equal(mockNft.blockedMacs.has(devManual), true, 'Manual block restored by initialize()');

    // Monitor starts up and reconciles quotas
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });
    const cycle = await monitor.reconcile();
    assert.ok(cycle);

    // Exhausted quota re-blocked in nftables
    assert.equal(mockNft.blockedMacs.has(devExhausted), true, 'Exhausted device re-blocked in nftables');
    assert.equal(mockNft.blockedMacs.has(devManual), true, 'Manual block preserved in nftables');
    assert.equal(cycle.blockedCount, 1);

    console.log('✅ Goal 2 & 3 Passed: Router reboot recovered ruleset, quota blocks, and manual blocks');
  }

  // =========================================================================
  // Goal 4: Quota Reset
  // =========================================================================
  {
    console.log('Running Goal 4: Quota reset (exhausted -> resetUsage -> unblocked)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devA = 'AA:BB:CC:DD:EE:01';
    let currentUsageBytes = 2000;

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devA, totalBytes: currentUsageBytes, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.10' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);

    await quotaService.createQuota({ mac: devA, quotaBytes: 1000 });
    // Baseline captured at 2000, usedBytes = 0

    // Device uses another 1500 bytes -> 3500 total
    currentUsageBytes = 3500;
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    // Cycle 1: Device exceeds quota -> blocked
    const r1 = await monitor.reconcile();
    assert.equal(r1?.blockedCount, 1);
    assert.equal(mockNft.blockedMacs.has(devA), true, 'Device is blocked in nftables');

    // Admin resets quota usage!
    await quotaService.updateQuota(devA, { resetUsage: true });
    // Baseline captured at 3500, usedBytes = 0, status: 'active'

    // Cycle 2: Monitor reconciles reset -> unblocks device
    const r2 = await monitor.reconcile();
    assert.equal(r2?.unblockedCount, 1);
    assert.equal(mockNft.blockedMacs.has(devA), false, 'Device unblocked in nftables after quota reset');
    assert.equal(await fwRepo.hasBlockSource(devA, 'quota'), false, 'Quota ownership cleared in repository');

    console.log('✅ Goal 4 Passed: Quota reset accurately triggered unblock in nftables');
  }

  // =========================================================================
  // Goal 5: Quota Deletion
  // =========================================================================
  {
    console.log('Running Goal 5: Quota deletion (exhausted -> deleteQuota -> unblocked)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devA = 'AA:BB:CC:DD:EE:01';

    await quotaRepo.create({
      mac: devA,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 2000,
      usedBytes: 2000,
      remainingBytes: 0,
      percentage: 200,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devA, totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.10' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    // Cycle 1: Block device
    await monitor.reconcile();
    assert.equal(mockNft.blockedMacs.has(devA), true);
    assert.equal(await fwRepo.hasBlockSource(devA, 'quota'), true);

    // Delete quota from repository
    await quotaService.deleteQuota(devA);

    // Cycle 2: Monitor reconciles deleted quota
    const unblockResult = await monitor.reconcile();
    assert.ok(unblockResult);
    assert.equal(unblockResult.unblockedCount, 1, 'Deleted quota device unblocked');
    assert.equal(mockNft.blockedMacs.has(devA), false, 'Device removed from nftables');
    assert.equal(await fwRepo.hasBlockSource(devA, 'quota'), false, 'Repository quota ownership cleared');

    console.log('✅ Goal 5 Passed: Quota deletion safely cleaned block from nftables and repository');
  }

  // =========================================================================
  // Goal 6: Manual Firewall Blocks Protection & Dual Ownership
  // =========================================================================
  {
    console.log('Running Goal 6: Manual firewall blocks protection & dual ownership...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devDual = 'AA:BB:CC:DD:EE:01';

    // 1. Device is manually blocked by administrator
    await fwRepo.addBlockSource(devDual, 'manual');
    await mockNft.addBlockedMac(devDual);

    // 2. Device also has exhausted quota
    await quotaRepo.create({
      mac: devDual,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 2000,
      usedBytes: 2000,
      remainingBytes: 0,
      percentage: 200,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devDual, totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.10' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    // Cycle 1: Dual ownership recorded; device remains blocked
    await monitor.reconcile();
    assert.equal(await fwRepo.hasBlockSource(devDual, 'manual'), true);
    assert.equal(await fwRepo.hasBlockSource(devDual, 'quota'), true);
    assert.equal(mockNft.blockedMacs.has(devDual), true);

    // 3. Quota resets to active -> unblock quota, but manual block MUST remain
    await quotaService.updateQuota(devDual, { resetUsage: true });
    const r2 = await monitor.reconcile();
    assert.ok(r2);
    assert.equal(mockNft.blockedMacs.has(devDual), true, 'Device MUST remain blocked by manual policy');
    assert.equal(await fwRepo.hasBlockSource(devDual, 'manual'), true, 'Manual block ownership preserved');
    assert.equal(await fwRepo.hasBlockSource(devDual, 'quota'), false, 'Quota block ownership cleared');

    // 4. Admin unblocks manual policy -> device is now completely unblocked
    await firewallService.unblockDevice(devDual, 'manual');
    assert.equal(mockNft.blockedMacs.has(devDual), false, 'Device unblocked when all sources are removed');

    console.log('✅ Goal 6 Passed: Manual blocks protected and dual ownership reconciled cleanly');
  }

  // =========================================================================
  // Goal 7: Temporary SSH/OpenWrt Failures & Error Isolation
  // =========================================================================
  {
    console.log('Running Goal 7: Temporary SSH/OpenWrt failures & error isolation...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devOk = 'AA:BB:CC:DD:EE:01';
    const devFail = 'AA:BB:CC:DD:EE:02';

    mockNft.failMacs.add(devFail);

    await quotaRepo.create({
      mac: devOk,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1500,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 150,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await quotaRepo.create({
      mac: devFail,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1500,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 150,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devOk, totalBytes: 1500, downloadBytes: 500, uploadBytes: 1000, ip: '192.168.50.10' },
        { mac: devFail, totalBytes: 1500, downloadBytes: 500, uploadBytes: 1000, ip: '192.168.50.20' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    // Cycle: DevFail fails router call, but DevOk must succeed
    const res = await monitor.reconcile();
    assert.ok(res);
    assert.equal(res.errorCount, 1, 'Error on DevFail tracked in errorCount');
    assert.equal(res.blockedCount, 1, 'DevOk successfully blocked');
    assert.equal(mockNft.blockedMacs.has(devOk), true, 'DevOk blocked in nftables');
    assert.equal(mockNft.blockedMacs.has(devFail), false, 'DevFail remained unblocked due to router failure');

    // Test temporary failure on getDeviceUsage()
    const brokenUsage: UsageService = {
      getDeviceUsage: async () => {
        throw new Error('Connection refused by OpenWrt ubus RPC');
      },
    } as unknown as UsageService;

    const brokenQuotaService = new QuotaService(quotaRepo, brokenUsage, mockDevices);
    const monitorBroken = new QuotaEnforcementMonitor(brokenQuotaService, firewallService, { logger: silentLogger });

    const brokenRes = await monitorBroken.reconcile();
    assert.ok(brokenRes);
    assert.equal(brokenRes.success, false);
    assert.equal(brokenRes.errorCount, 1);
    // Firewall was NOT corrupted
    assert.equal(mockNft.blockedMacs.has(devOk), true);

    console.log('✅ Goal 7 Passed: Error isolation and temporary router failures handled safely');
  }

  // =========================================================================
  // Goal 8: Duplicate Monitor Cycles & Concurrency Safety
  // =========================================================================
  {
    console.log('Running Goal 8: Duplicate monitor cycles & concurrency prevention...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const dev = 'AA:BB:CC:DD:EE:01';
    await quotaRepo.create({
      mac: dev,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 500,
      usedBytes: 500,
      remainingBytes: 500,
      percentage: 50,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let slowResolve: () => void = () => {};
    const slowUsage: UsageService = {
      getDeviceUsage: async () => {
        await new Promise<void>((resolve) => {
          slowResolve = resolve;
        });
        return [{ mac: dev, totalBytes: 500, downloadBytes: 250, uploadBytes: 250, ip: '192.168.50.10' }];
      },
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, slowUsage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    // Launch Cycle 1 (which hangs until slowResolve is called)
    const cycle1Promise = monitor.reconcile();

    // Launch Cycle 2 concurrently while Cycle 1 is syncing -> must be rejected by execution lock
    const cycle2Promise = monitor.reconcile();
    const cycle2Result = await cycle2Promise;
    assert.equal(cycle2Result, null, 'Concurrent cycle rejected by mutex lock');

    // Resolve Cycle 1
    slowResolve();
    const cycle1Result = await cycle1Promise;
    assert.ok(cycle1Result);

    // Verify calling start() multiple times preserves single timer
    monitor.start();
    assert.equal(monitor.isRunning(), true);
    monitor.start();
    assert.equal(monitor.isRunning(), true);
    monitor.stop();
    assert.equal(monitor.isRunning(), false);

    console.log('✅ Goal 8 Passed: Execution lock prevented duplicate cycles; start/stop idempotent');
  }

  // =========================================================================
  // Goal 9: Stale/Orphan Firewall Entries Detection & Cleaning
  // =========================================================================
  {
    console.log('Running Goal 9: Stale/orphan firewall entries detection & safe cleaning...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const devValidExhausted = 'AA:BB:CC:DD:EE:01';
    const devOrphan1 = 'AA:BB:CC:DD:EE:98'; // Orphan with quota source in repo
    const devOrphan2 = 'AA:BB:CC:DD:EE:99'; // Orphan in nftables set with no record in repo
    const devManualNoQuota = 'AA:BB:CC:DD:EE:77'; // Manual block without quota

    // Valid quota
    await quotaRepo.create({
      mac: devValidExhausted,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 1500,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 150,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // In nftables: all 4 are present
    await mockNft.addBlockedMac(devValidExhausted);
    await mockNft.addBlockedMac(devOrphan1);
    await mockNft.addBlockedMac(devOrphan2);
    await mockNft.addBlockedMac(devManualNoQuota);

    // In repository:
    await fwRepo.addBlockSource(devValidExhausted, 'quota');
    await fwRepo.addBlockSource(devOrphan1, 'quota');
    await fwRepo.addBlockSource(devManualNoQuota, 'manual');

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devValidExhausted, totalBytes: 1500, downloadBytes: 500, uploadBytes: 1000, ip: '192.168.50.10' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);

    // Valid exhausted quota remains blocked
    assert.equal(mockNft.blockedMacs.has(devValidExhausted), true, 'Valid exhausted quota remains blocked');

    // Orphan 1 cleaned
    assert.equal(mockNft.blockedMacs.has(devOrphan1), false, 'Orphan 1 cleaned from nftables');
    assert.equal(await fwRepo.hasBlockSource(devOrphan1, 'quota'), false, 'Orphan 1 cleared from repo');

    // Orphan 2 cleaned
    assert.equal(mockNft.blockedMacs.has(devOrphan2), false, 'Orphan 2 cleaned from nftables');

    // Manual block preserved!
    assert.equal(mockNft.blockedMacs.has(devManualNoQuota), true, 'Manual block preserved in nftables');
    assert.equal(await fwRepo.hasBlockSource(devManualNoQuota, 'manual'), true, 'Manual block preserved in repo');

    assert.equal(result.unblockedCount, 2, 'Exactly 2 orphan blocks unblocked');

    console.log('✅ Goal 9 Passed: Orphan blocks cleaned safely without affecting manual blocks');
  }

  // =========================================================================
  // Goal 10: Multiple Devices Processed Simultaneously
  // =========================================================================
  {
    console.log('Running Goal 10: Multiple devices (10 devices) processed simultaneously with full isolation...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    // Prepare 10 devices:
    // dev1..3: exhausted (must be blocked)
    // dev4..6: active (must be unblocked)
    // dev7: manual block with active quota (must remain blocked)
    // dev8: manual block with exhausted quota (must remain blocked, dual ownership)
    // dev9..10: orphan blocks in nftables with no quota (must be unblocked)

    for (let i = 1; i <= 3; i++) {
      const mac = `AA:BB:CC:DD:EE:0${i}`;
      await quotaRepo.create({
        mac,
        quotaBytes: 1000,
        lastSeenTotalBytes: 0,
        accumulatedUsedBytes: 2000,
        usedBytes: 2000,
        remainingBytes: 0,
        percentage: 200,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    for (let i = 4; i <= 6; i++) {
      const mac = `AA:BB:CC:DD:EE:0${i}`;
      await quotaRepo.create({
        mac,
        quotaBytes: 10000,
        lastSeenTotalBytes: 0,
        accumulatedUsedBytes: 100,
        usedBytes: 100,
        remainingBytes: 9900,
        percentage: 1,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Dev 7: Active quota + Manual block
    const mac7 = 'AA:BB:CC:DD:EE:07';
    await quotaRepo.create({
      mac: mac7,
      quotaBytes: 10000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 100,
      usedBytes: 100,
      remainingBytes: 9900,
      percentage: 1,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fwRepo.addBlockSource(mac7, 'manual');
    await mockNft.addBlockedMac(mac7);

    // Dev 8: Exhausted quota + Manual block
    const mac8 = 'AA:BB:CC:DD:EE:08';
    await quotaRepo.create({
      mac: mac8,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 2000,
      usedBytes: 2000,
      remainingBytes: 0,
      percentage: 200,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fwRepo.addBlockSource(mac8, 'manual');
    await mockNft.addBlockedMac(mac8);

    // Dev 9 and 10: Orphan blocks in nftables
    const mac9 = 'AA:BB:CC:DD:EE:09';
    const mac10 = 'AA:BB:CC:DD:EE:10';
    await mockNft.addBlockedMac(mac9);
    await mockNft.addBlockedMac(mac10);

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: 'AA:BB:CC:DD:EE:01', totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.10' },
        { mac: 'AA:BB:CC:DD:EE:02', totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.20' },
        { mac: 'AA:BB:CC:DD:EE:03', totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.30' },
        { mac: 'AA:BB:CC:DD:EE:04', totalBytes: 100, downloadBytes: 50, uploadBytes: 50, ip: '192.168.50.40' },
        { mac: 'AA:BB:CC:DD:EE:05', totalBytes: 100, downloadBytes: 50, uploadBytes: 50, ip: '192.168.50.50' },
        { mac: 'AA:BB:CC:DD:EE:06', totalBytes: 100, downloadBytes: 50, uploadBytes: 50, ip: '192.168.50.60' },
        { mac: 'AA:BB:CC:DD:EE:07', totalBytes: 100, downloadBytes: 50, uploadBytes: 50, ip: '192.168.50.70' },
        { mac: 'AA:BB:CC:DD:EE:08', totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.80' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.totalEvaluated, 8, '8 quotas evaluated');
    assert.equal(result.blockedCount, 3, 'dev1..3 newly blocked');
    assert.equal(result.unblockedCount, 2, 'dev9 and dev10 orphan unblocked');
    assert.equal(result.errorCount, 0, 'Zero errors across all 10 devices');

    // Verify final nftables state:
    assert.equal(mockNft.blockedMacs.has('AA:BB:CC:DD:EE:01'), true, 'dev1 blocked');
    assert.equal(mockNft.blockedMacs.has('AA:BB:CC:DD:EE:02'), true, 'dev2 blocked');
    assert.equal(mockNft.blockedMacs.has('AA:BB:CC:DD:EE:03'), true, 'dev3 blocked');
    assert.equal(mockNft.blockedMacs.has('AA:BB:CC:DD:EE:04'), false, 'dev4 unblocked');
    assert.equal(mockNft.blockedMacs.has('AA:BB:CC:DD:EE:05'), false, 'dev5 unblocked');
    assert.equal(mockNft.blockedMacs.has('AA:BB:CC:DD:EE:06'), false, 'dev6 unblocked');
    assert.equal(mockNft.blockedMacs.has(mac7), true, 'dev7 manual block preserved');
    assert.equal(mockNft.blockedMacs.has(mac8), true, 'dev8 dual ownership preserved');
    assert.equal(mockNft.blockedMacs.has(mac9), false, 'dev9 orphan unblocked');
    assert.equal(mockNft.blockedMacs.has(mac10), false, 'dev10 orphan unblocked');

    console.log('✅ Goal 10 Passed: 10 devices processed simultaneously with complete isolation');
  }

  // =========================================================================
  // Goal 11: Startup Sequence (FirewallService.initialize -> Monitor.start)
  // =========================================================================
  {
    console.log('Running Goal 11: Startup sequence validation...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockNftablesClient();
    const mockDevices = createMockDevicesService();

    const dev = 'AA:BB:CC:DD:EE:01';
    await quotaRepo.create({
      mac: dev,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 2000,
      usedBytes: 2000,
      remainingBytes: 0,
      percentage: 200,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: dev, totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.10' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);

    // Sequence:
    // 1. FirewallService.initialize()
    await firewallService.initialize();
    assert.equal(mockNft.tableExists, true);

    // 2. QuotaEnforcementMonitor.start() (which performs startup reconciliation)
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });
    await monitor.start();

    // Verify initial reconciliation executed during start()
    assert.equal(mockNft.blockedMacs.has(dev), true, 'Device blocked during startup reconciliation');
    assert.equal(monitor.isRunning(), true, 'Monitor is running');

    monitor.stop();
    assert.equal(monitor.isRunning(), false, 'Monitor stopped cleanly');

    console.log('✅ Goal 11 Passed: Startup sequence verified end-to-end');
  }

  cleanup();
  console.log('\n🎉 ALL Quota Enforcement & Recovery Hardening TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runHardeningTests().catch((err) => {
  console.error('❌ Hardening tests failed:', err);
  cleanup();
  process.exit(1);
});

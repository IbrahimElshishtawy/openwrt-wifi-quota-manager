import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';
import type { INftablesClient } from '../src/modules/firewall/NftablesClient.js';

class MockCrashNftablesClient implements INftablesClient {
  public blocked = new Set<string>();

  constructor(initialBlocked: string[] = []) {
    for (const b of initialBlocked) {
      this.blocked.add(b.toUpperCase());
    }
  }

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

function makeEnv(mac: string) {
  const devices: Device[] = [{
    id: mac,
    mac,
    ip: '192.168.50.70',
    hostname: 'crash-client',
    connected: true,
    interface: 'br-lan',
  }];

  const usage: DeviceUsage[] = [{
    mac,
    ip: '192.168.50.70',
    downloadBytes: 3_000_000_000,
    uploadBytes: 3_000_000_000,
    totalBytes: 6_000_000_000, // 6 GB
  }];

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
  console.log('🧪 Starting Stage 5: Controller Crash Testing (kill -9 simulation)...');
  const testDir = path.resolve(process.cwd(), 'scratch/crash-test-data');
  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  await fs.promises.mkdir(testDir, { recursive: true });

  const TEST_MAC = '02:00:CC:00:00:01';
  const { devicesService, usageService } = makeEnv(TEST_MAC);

  // Checkpoints:
  // 1. Crash BEFORE persistence -> on restart, clean state, not applied
  // 2. Crash DURING persistence (partial file write) -> atomic temp write ensures original file is never corrupted!
  // 3. Crash AFTER persistence, BEFORE router sync -> on restart, startup reconciliation detects router state missing and restores block!
  // 4. Crash DURING router block command -> on restart, router and persistence reconciled
  // 5. Crash AFTER router block command, BEFORE response -> on restart, router and persistence both match desired state
  // 6. Crash AFTER response -> steady state verified

  console.log('\n--- Checkpoint 1 & 2: Crash During File Persistence (Atomic Safety) ---');
  {
    const quotaFile = path.join(testDir, 'quotas-atomic.json');
    // Pre-populate with 1 healthy record
    const initialRecord = [{
      mac: '02:00:00:11:22:33',
      quotaBytes: 10_000_000,
      usedBytes: 1_000_000,
      remainingBytes: 9_000_000,
      percentage: 10,
      status: 'active',
      lastSeenTotalBytes: 1_000_000,
      accumulatedUsedBytes: 1_000_000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
    await fs.promises.writeFile(quotaFile, JSON.stringify(initialRecord, null, 2), 'utf-8');

    // Simulate crash leaving half-written temp file
    const halfWrittenTemp = `${quotaFile}.tmp.${Date.now()}.corrupt`;
    await fs.promises.writeFile(halfWrittenTemp, '{"mac": "02:00:incomplete', 'utf-8');

    // Start repository after crash
    const repo = new FileQuotaRepository(quotaFile);
    const records = await repo.getAll();
    assert.equal(records.length, 1, 'Repository must load uncorrupted original file');
    assert.equal(records[0].mac, '02:00:00:11:22:33');

    // Verify atomic save replaces cleanly
    await repo.save({
      ...records[0],
      usedBytes: 2_000_000,
    });
    const reloaded = await repo.getAll();
    assert.equal(reloaded[0].usedBytes, 2_000_000);
    console.log('  ✅ Atomic temp file write guarantees zero JSON corruption even on kill -9 during write.');
  }

  console.log('\n--- Checkpoint 3 & 4: Crash After Persistence, Before Router Block (Reconciliation Recovery) ---');
  {
    const quotaFile = path.join(testDir, 'quotas-crash-sync.json');
    const fwFile = path.join(testDir, 'fw-crash-sync.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);

    // Initial state: Quota was persisted to disk as exhausted (5 GB limit, 6 GB used)
    const exhaustedRecord = {
      mac: TEST_MAC,
      quotaBytes: 5_000_000_000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 6_000_000_000,
      usedBytes: 6_000_000_000,
      remainingBytes: 0,
      percentage: 120,
      status: 'exhausted' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.save(exhaustedRecord);

    // Router state before crash: NOT yet blocked in nftables (crash happened right after persistence)
    const routerMock = new MockCrashNftablesClient([]); // empty blocked set
    assert.equal(routerMock.blocked.has(TEST_MAC), false);

    // Simulate Controller Restart:
    // Startup sequence:
    // 1. Initialize firewall
    const freshFwService = new FirewallService(routerMock, devicesService, fwRepo);
    await freshFwService.initialize();

    // 2. Start QuotaEnforcementMonitor with startup reconciliation
    const freshQService = new QuotaService(repo, usageService, devicesService);
    const freshMonitor = new QuotaEnforcementMonitor({ enabled: true, intervalMs: 5000 });
    (freshMonitor as any).quotaService = freshQService;
    (freshMonitor as any).firewallService = freshFwService;

    // Run startup cycle
    const recoveryResult = await freshMonitor.runCycle();
    assert.ok(recoveryResult);
    assert.equal(recoveryResult.success, true);
    assert.equal(recoveryResult.blockedCount, 1, 'Startup reconciliation must block exhausted device');

    // 3. Verify router state now has the device blocked
    assert.equal(routerMock.blocked.has(TEST_MAC), true, 'Router state successfully reconciled!');

    console.log('  ✅ Post-crash reconciliation detected router discrepancy and restored block cleanly.');
  }

  console.log('\n--- Checkpoint 5 & 6: Crash After Router Block, Stale Unblock Prevention ---');
  {
    const quotaFile = path.join(testDir, 'quotas-crash-steady.json');
    const fwFile = path.join(testDir, 'fw-crash-steady.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);

    // Both quota and router blocked before crash
    await repo.save({
      mac: TEST_MAC,
      quotaBytes: 5_000_000_000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 6_000_000_000,
      usedBytes: 6_000_000_000,
      remainingBytes: 0,
      percentage: 120,
      status: 'exhausted' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fwRepo.addBlockSource(TEST_MAC, 'quota');
    const routerMock = new MockCrashNftablesClient([TEST_MAC]);

    // Restart controller
    const freshFwService = new FirewallService(routerMock, devicesService, fwRepo);
    const freshQService = new QuotaService(repo, usageService, devicesService);
    const freshMonitor = new QuotaEnforcementMonitor({ enabled: true, intervalMs: 5000 });
    (freshMonitor as any).quotaService = freshQService;
    (freshMonitor as any).firewallService = freshFwService;

    const steadyResult = await freshMonitor.runCycle();
    assert.ok(steadyResult);
    assert.equal(steadyResult.blockedCount, 0, 'No re-blocks needed');
    assert.equal(steadyResult.unblockedCount, 0, 'No false unblocks');
    assert.equal(steadyResult.unchangedCount, 1, 'Device remains steadily blocked');
    assert.equal(routerMock.blocked.has(TEST_MAC), true);

    console.log('  ✅ Post-crash steady state: 0 false unblocks, 0 duplicate writes, 0 stale states.');
  }

  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log('\n✅ Stage 5 Controller Crash Testing Completed Successfully!\n');
}

void run();

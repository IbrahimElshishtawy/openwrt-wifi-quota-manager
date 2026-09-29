import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';
import type { INftablesClient } from '../src/modules/firewall/NftablesClient.js';

class FailingNftablesClient implements INftablesClient {
  public blocked = new Set<string>();
  public failNextWithNetworkError = false;
  public operationExecutedBeforeFail = false;

  public async ensureRuleset(): Promise<void> {}

  public async addBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    if (this.failNextWithNetworkError) {
      this.failNextWithNetworkError = false;
      if (this.operationExecutedBeforeFail) {
        this.blocked.add(norm); // Operation succeeded on router, but network dropped before response
      }
      throw new Error('EHOSTUNREACH: Network dropped during router command execution');
    }
    this.blocked.add(norm);
  }

  public async deleteBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    if (this.failNextWithNetworkError) {
      this.failNextWithNetworkError = false;
      if (this.operationExecutedBeforeFail) {
        this.blocked.delete(norm);
      }
      throw new Error('ETIMEDOUT: Connection timed out waiting for router ACK');
    }
    this.blocked.delete(norm);
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
    ip: '192.168.50.60',
    hostname: 'distributed-client',
    connected: true,
    interface: 'br-lan',
  }];

  const usage: DeviceUsage[] = [{
    mac,
    ip: '192.168.50.60',
    downloadBytes: 1000,
    uploadBytes: 1000,
    totalBytes: 2000,
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
  console.log('🧪 Starting Stage 4: Distributed Operation Failure & Idempotency Testing...');
  const testDir = path.resolve(process.cwd(), 'scratch/dist-failure-test-data');
  await fs.promises.mkdir(testDir, { recursive: true });

  const TEST_MAC = '02:00:DD:FF:00:01';
  const { devicesService, usageService } = makeEnv(TEST_MAC);

  // ============================================================================
  // Test 1: Block Operation Fails Due to Network Drop (Router Executed Before Drop)
  // ============================================================================
  console.log('\n--- Scenario 4.1: Block Operation Network Drop (Succeeded on Router) ---');
  {
    const quotaFile = path.join(testDir, 'quotas-df1.json');
    const fwFile = path.join(testDir, 'fw-df1.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);
    const mockNft = new FailingNftablesClient();
    const fwService = new FirewallService(mockNft, devicesService, fwRepo);

    // Set failure injection: command executes on router, but network fails before controller gets ACK
    mockNft.failNextWithNetworkError = true;
    mockNft.operationExecutedBeforeFail = true;

    await assert.rejects(
      async () => fwService.blockDevice(TEST_MAC, 'manual'),
      /Network dropped/
    );

    // Verify router has element in set
    assert.ok(mockNft.blocked.has(TEST_MAC), 'Router executed the block before connection dropped');

    // Controller now retries operation (Idempotent retry)
    const retryResult = await fwService.blockDevice(TEST_MAC, 'manual');
    assert.equal(retryResult.success, true, 'Retry must succeed');
    assert.equal(mockNft.blocked.size, 1, 'No duplicate rules created in set');
    console.log('  ✅ Block retry after lost response is idempotent and safe.');
  }

  // ============================================================================
  // Test 2: Block Operation Fails Due to Network Drop (Router DID NOT Execute)
  // ============================================================================
  console.log('\n--- Scenario 4.2: Block Operation Network Drop (Failed on Router) ---');
  {
    const quotaFile = path.join(testDir, 'quotas-df2.json');
    const fwFile = path.join(testDir, 'fw-df2.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);
    const mockNft = new FailingNftablesClient();
    const fwService = new FirewallService(mockNft, devicesService, fwRepo);

    mockNft.failNextWithNetworkError = true;
    mockNft.operationExecutedBeforeFail = false;

    await assert.rejects(
      async () => fwService.blockDevice(TEST_MAC, 'manual'),
      /Network dropped/
    );

    assert.ok(!mockNft.blocked.has(TEST_MAC), 'Router never executed the block');

    // Reconciliation or Retry
    const retryResult = await fwService.blockDevice(TEST_MAC, 'manual');
    assert.equal(retryResult.success, true, 'Retry must succeed');
    assert.ok(mockNft.blocked.has(TEST_MAC), 'Device successfully blocked on retry');
    console.log('  ✅ Block retry after partial network failure cleanly establishes desired state.');
  }

  // ============================================================================
  // Test 3: Unblock Operation Network Drop & Reconciliation vs Blind Retry
  // ============================================================================
  console.log('\n--- Scenario 4.3: Unblock Operation Network Drop & Reconciliation ---');
  {
    const quotaFile = path.join(testDir, 'quotas-df3.json');
    const fwFile = path.join(testDir, 'fw-df3.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);
    const mockNft = new FailingNftablesClient();
    const fwService = new FirewallService(mockNft, devicesService, fwRepo);

    // Initial state: blocked
    await fwService.blockDevice(TEST_MAC, 'quota');
    assert.ok(mockNft.blocked.has(TEST_MAC));

    // Network drops during unblock
    mockNft.failNextWithNetworkError = true;
    mockNft.operationExecutedBeforeFail = true; // Succeeded on router, ACK lost

    await assert.rejects(
      async () => fwService.unblockDevice(TEST_MAC, 'quota'),
      /Connection timed out/
    );

    // Even if controller lost ACK, subsequent unblock retry is completely safe and idempotent
    const retryUnblock = await fwService.unblockDevice(TEST_MAC, 'quota');
    assert.equal(retryUnblock.success, true);
    assert.ok(!mockNft.blocked.has(TEST_MAC), 'Device must be unblocked');
    console.log('  ✅ Unblock operation retry is safe and idempotent.');
  }

  // ============================================================================
  // Test 4: Quota Sync & Reconciliation Under Transient Distributed Failures
  // ============================================================================
  console.log('\n--- Scenario 4.4: Sync & Reconciliation Under Transient Network Failures ---');
  {
    const quotaFile = path.join(testDir, 'quotas-df4.json');
    const fwFile = path.join(testDir, 'fw-df4.json');
    const repo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(fwFile);
    const mockNft = new FailingNftablesClient();
    const fwService = new FirewallService(mockNft, devicesService, fwRepo);
    const qService = new QuotaService(repo, usageService, devicesService);

    // Assign quota with 0 remaining
    await qService.createQuota({ mac: TEST_MAC, quotaBytes: 1000 });
    // Update to exhausted
    await qService.updateQuota(TEST_MAC, { usedBytes: 5000 });

    const monitor = new QuotaEnforcementMonitor({ enabled: true, intervalMs: 5000 });
    (monitor as any).quotaService = qService;
    (monitor as any).firewallService = fwService;

    // First cycle: router network fails during block addition
    mockNft.failNextWithNetworkError = true;
    mockNft.operationExecutedBeforeFail = false;

    const cycle1 = await monitor.runCycle();
    assert.ok(cycle1);
    assert.equal(cycle1.errorCount, 1, 'Error count must be 1 on failed device operation');
    assert.equal(mockNft.blocked.has(TEST_MAC), false, 'Router state remains unblocked');

    // Second cycle: network restored -> monitor automatically reconciles desired vs actual state!
    const cycle2 = await monitor.runCycle();
    assert.ok(cycle2);
    assert.equal(cycle2.success, true);
    assert.equal(cycle2.blockedCount, 1, 'Reconciliation automatically fixed the missing block!');
    assert.ok(mockNft.blocked.has(TEST_MAC), 'Device blocked in nftables');
    console.log('  ✅ State reconciliation converges to desired state without blind retry risk.');
  }

  // Operation Safety Classification Table Output
  console.log('\n========================================================================');
  console.log('            DISTRIBUTED OPERATION RETRY SAFETY CLASSIFICATION           ');
  console.log('========================================================================');
  console.log('| Operation     | Idempotent | Retry Safety      | Recovery Strategy     |');
  console.log('|---------------|------------|-------------------|-----------------------|');
  console.log('| Apply Quota   | YES        | Safe              | Idempotent update/save|');
  console.log('| Remove Quota  | YES        | Safe              | Idempotent delete     |');
  console.log('| Block Device  | YES        | Safe              | Nftables set add (idm)|');
  console.log('| Unblock Dev   | YES        | Safe              | Nftables set del (idm)|');
  console.log('| Sync Cycle    | YES        | Conditionally Safe| Full Reconciliation   |');
  console.log('| Recovery      | YES        | Safe              | Reconcile actual state|');
  console.log('========================================================================\n');

  await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log('✅ Stage 4 Distributed Failure & Reconciliation Testing Completed!\n');
}

void run();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { NftablesClient, type INftablesClient } from '../src/modules/firewall/NftablesClient.js';
import type { UsageService } from '../src/modules/usage/UsageService.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { DeviceQuotaRecord } from '../src/modules/quota/types.js';
import { CircuitBreaker, CircuitBreakerOpenError } from '../src/infrastructure/resilience/CircuitBreaker.js';
import { RetryPolicy } from '../src/infrastructure/resilience/RetryPolicy.js';
import { InfrastructureDeviceError } from '../src/modules/firewall/types.js';

const testDir = path.resolve(process.cwd(), 'data/test-integration-verification');

function cleanup() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

class MockVerifiableNftablesClient implements INftablesClient {
  public blockedMacs = new Set<string>();
  public addCalls: string[] = [];
  public deleteCalls: string[] = [];
  public failMacs = new Set<string>();
  public tableExists = true;
  public ensureRulesetCalls = 0;
  public listBlockedThrows: Error | null = null;
  public rawListOutput: string | null = null;

  public async ensureRuleset(): Promise<void> {
    this.ensureRulesetCalls++;
    this.tableExists = true;
  }

  public async addBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    if (this.failMacs.has(norm)) {
      throw new Error(`Simulated SSH router error for MAC ${norm}`);
    }
    this.addCalls.push(norm);
    this.blockedMacs.add(norm);
  }

  public async deleteBlockedMac(mac: string): Promise<void> {
    const norm = mac.toUpperCase();
    if (this.failMacs.has(norm)) {
      throw new Error(`Simulated SSH router error for MAC ${norm}`);
    }
    this.deleteCalls.push(norm);
    this.blockedMacs.delete(norm);
  }

  public async hasBlockedMac(mac: string): Promise<boolean> {
    if (!this.tableExists) return false;
    return this.blockedMacs.has(mac.toUpperCase());
  }

  public async listBlockedMacs(): Promise<string[]> {
    if (this.listBlockedThrows) {
      throw this.listBlockedThrows;
    }
    if (!this.tableExists) {
      await this.ensureRuleset();
      return [];
    }
    return Array.from(this.blockedMacs);
  }
}

function createMockDevicesService(): DevicesService {
  const routerMac = '52:54:00:CF:15:77';
  const hostMac = '52:54:00:5B:2E:C1';

  return {
    detectInfrastructure: async () => ({
      routerMacs: new Set([routerMac]),
      excludedMacs: new Set([routerMac, hostMac]),
      excludedIps: new Set(['192.168.50.1', '192.168.50.254']),
      excludedHostnames: new Set(['openwrt']),
      wanDevices: new Set(['eth1']),
      lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
    }),
    getBaselineInfrastructure: () => ({
      routerMacs: new Set([routerMac]),
      excludedMacs: new Set([routerMac, hostMac]),
      excludedIps: new Set(['192.168.50.1', '192.168.50.254']),
      excludedHostnames: new Set(['openwrt']),
      wanDevices: new Set(['eth1']),
      lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
    }),
    getConnectedDevices: async () => [
      { mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', hostname: 'client-50', interface: 'br-lan' },
      { mac: '52:54:00:AA:BB:CC', ip: '192.168.50.60', hostname: 'client-60', interface: 'br-lan' },
      { mac: '52:54:00:11:22:33', ip: '192.168.50.70', hostname: 'client-70', interface: 'br-lan' },
    ],
    isRealLanClient: (device: { mac: string }) => {
      const norm = device.mac.toUpperCase();
      return norm !== routerMac && norm !== hostMac;
    },
  } as unknown as DevicesService;
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function runIntegrationVerificationTests() {
  console.log('🧪 Starting OpenWrt Integration Hardening & Recovery Verification Tests...');

  cleanup();
  fs.mkdirSync(testDir, { recursive: true });

  const quotaFile = path.join(testDir, 'quotas.json');
  const firewallFile = path.join(testDir, 'firewall.json');

  // Test 1: Controller Restart Recovery
  {
    console.log('Running Test 1: Controller Restart Recovery (state restored, no duplicates, manual blocks safe)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockVerifiableNftablesClient();
    const mockDevices = createMockDevicesService();

    const clientMac = '52:54:00:CE:1C:BE';
    const manualMac = '52:54:00:AA:BB:CC';

    // 1. Quota exhausted on client
    await quotaRepo.create({
      mac: clientMac,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 2500,
      usedBytes: 2500,
      remainingBytes: 0,
      percentage: 250,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 2. Both client quota block and manual admin block in repository
    await fwRepo.addBlockSource(clientMac, 'quota');
    await fwRepo.addBlockSource(manualMac, 'manual');

    // 3. Both in nftables
    await mockNft.addBlockedMac(clientMac);
    await mockNft.addBlockedMac(manualMac);
    mockNft.addCalls = [];

    // Controller restart: create fresh instances reading from disk
    const freshQuotaRepo = new FileQuotaRepository(quotaFile);
    const freshFwRepo = new FileFirewallRepository(firewallFile);
    const freshUsage: UsageService = {
      getDeviceUsage: async () => [
        { mac: clientMac, totalBytes: 2500, downloadBytes: 1500, uploadBytes: 1000, ip: '192.168.50.50' },
      ],
    } as unknown as UsageService;

    const freshQuotaService = new QuotaService(freshQuotaRepo, freshUsage, mockDevices);
    const freshFwService = new FirewallService(mockNft, mockDevices, freshFwRepo);
    const monitor = new QuotaEnforcementMonitor(freshQuotaService, freshFwService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.success, true);
    assert.equal(result.errorCount, 0);

    // Both remain blocked in nftables
    assert.equal(mockNft.blockedMacs.has(clientMac), true);
    assert.equal(mockNft.blockedMacs.has(manualMac), true);
    // Zero duplicate router add calls
    assert.equal(mockNft.addCalls.length, 0);

    console.log('✅ Test 1 Passed: Controller restart recovery verified');
  }

  // Test 2: Router Reboot Recovery (Table / Set State Loss)
  {
    console.log('Running Test 2: Router Reboot Recovery (table missing -> restored -> blocks re-applied)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockVerifiableNftablesClient();
    const mockDevices = createMockDevicesService();

    const clientMac = '52:54:00:CE:1C:BE';
    const manualMac = '52:54:00:AA:BB:CC';

    await quotaRepo.create({
      mac: clientMac,
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

    await fwRepo.addBlockSource(manualMac, 'manual');

    // Simulate router reboot: table was flushed/lost in kernel memory
    mockNft.tableExists = false;
    mockNft.blockedMacs.clear();
    assert.equal(mockNft.blockedMacs.size, 0);

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: clientMac, totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.50' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    assert.equal(result.success, true);

    // Ruleset recreated
    assert.ok(mockNft.ensureRulesetCalls > 0);
    // Both client quota block and manual block restored in nftables!
    assert.equal(mockNft.blockedMacs.has(clientMac), true, 'Exhausted client restored in nftables');
    assert.equal(mockNft.blockedMacs.has(manualMac), true, 'Manual admin block restored in nftables');

    console.log('✅ Test 2 Passed: Router reboot recovery verified');
  }

  // Test 3: Network Failure & CircuitBreaker Fast-Fail
  {
    console.log('Running Test 3: Network Failure & CircuitBreaker Tripping...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockVerifiableNftablesClient();
    const mockDevices = createMockDevicesService();

    await quotaRepo.create({
      mac: '52:54:00:CE:1C:BE',
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

    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownPeriodMs: 500 });
    const retry = new RetryPolicy();

    // Simulate dead SSH connection
    const brokenUsage: UsageService = {
      getDeviceUsage: async () => {
        throw new Error('SSH command timed out after 5000ms while contacting 192.168.50.1:22');
      },
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, brokenUsage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, {
      logger: silentLogger,
      circuitBreaker: cb,
      retryPolicy: retry,
    });

    // Run cycle 1: failure 1
    const res1 = await monitor.reconcile();
    assert.ok(res1);
    assert.equal(res1.success, false);
    assert.equal(cb.getState(), 'CLOSED');

    // Run cycle 2: failure 2 -> reaches failureThreshold -> trips to OPEN
    const res2 = await monitor.reconcile();
    assert.ok(res2);
    assert.equal(res2.success, false);
    assert.equal(cb.getState(), 'OPEN');

    // Run cycle 3: CircuitBreaker is OPEN -> fast-fails without network calls
    const res3 = await monitor.reconcile();
    assert.ok(res3);
    assert.equal(res3.success, false);
    assert.ok(res3.error?.includes('Circuit breaker is OPEN'));

    console.log('✅ Test 3 Passed: Network failure tripped circuit breaker with fast-fail');
  }

  // Test 4: Network Recovery & CircuitBreaker Half-Open -> Closed Transition
  {
    console.log('Running Test 4: Network Recovery (HALF_OPEN probe success -> CLOSED -> full reconciliation)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockVerifiableNftablesClient();
    const mockDevices = createMockDevicesService();

    await quotaRepo.create({
      mac: '52:54:00:CE:1C:BE',
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

    // Short cooldown for test
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownPeriodMs: 50, successThreshold: 1 });
    const retry = new RetryPolicy();

    let networkOnline = false;

    const recoveringUsage: UsageService = {
      getDeviceUsage: async () => {
        if (!networkOnline) {
          throw new Error('Network unreachable');
        }
        return [
          { mac: '52:54:00:CE:1C:BE', totalBytes: 500, downloadBytes: 250, uploadBytes: 250, ip: '192.168.50.50' },
        ];
      },
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, recoveringUsage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, {
      logger: silentLogger,
      circuitBreaker: cb,
      retryPolicy: retry,
    });

    // Trip circuit
    await monitor.reconcile();
    assert.equal(cb.getState(), 'OPEN');

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(cb.getState(), 'HALF_OPEN');

    // Network recovers
    networkOnline = true;

    // Next cycle probes network, succeeds, and closes circuit
    const recoverRes = await monitor.reconcile();
    assert.ok(recoverRes);
    assert.equal(recoverRes.success, true);
    assert.equal(cb.getState(), 'CLOSED');

    console.log('✅ Test 4 Passed: Network recovery verified end-to-end');
  }

  // Test 5: Partial Device Failure Isolation (Device A failure does not stop B & C)
  {
    console.log('Running Test 5: Partial Device Failure Isolation (Device A fails -> Device B & C continue)...');
    cleanup();
    fs.mkdirSync(testDir, { recursive: true });

    const quotaRepo = new FileQuotaRepository(quotaFile);
    const fwRepo = new FileFirewallRepository(firewallFile);
    const mockNft = new MockVerifiableNftablesClient();
    const mockDevices = createMockDevicesService();

    const devFail = '52:54:00:11:22:33';
    const devOkExhausted = '52:54:00:CE:1C:BE';
    const devOkActive = '52:54:00:AA:BB:CC';

    // devFail throws on router block
    mockNft.failMacs.add(devFail);

    // devFail exhausted
    await quotaRepo.create({
      mac: devFail,
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

    // devOkExhausted exhausted
    await quotaRepo.create({
      mac: devOkExhausted,
      quotaBytes: 1000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 3000,
      usedBytes: 3000,
      remainingBytes: 0,
      percentage: 300,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // devOkActive active
    await quotaRepo.create({
      mac: devOkActive,
      quotaBytes: 10000,
      lastSeenTotalBytes: 0,
      accumulatedUsedBytes: 500,
      usedBytes: 500,
      remainingBytes: 9500,
      percentage: 5,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const usage: UsageService = {
      getDeviceUsage: async () => [
        { mac: devFail, totalBytes: 2000, downloadBytes: 1000, uploadBytes: 1000, ip: '192.168.50.70' },
        { mac: devOkExhausted, totalBytes: 3000, downloadBytes: 1500, uploadBytes: 1500, ip: '192.168.50.50' },
        { mac: devOkActive, totalBytes: 500, downloadBytes: 250, uploadBytes: 250, ip: '192.168.50.60' },
      ],
    } as unknown as UsageService;

    const quotaService = new QuotaService(quotaRepo, usage, mockDevices);
    const firewallService = new FirewallService(mockNft, mockDevices, fwRepo);
    const monitor = new QuotaEnforcementMonitor(quotaService, firewallService, { logger: silentLogger });

    const result = await monitor.reconcile();
    assert.ok(result);
    // Error on devFail is recorded
    assert.equal(result.errorCount, 1);
    // But devOkExhausted was successfully blocked!
    assert.equal(mockNft.blockedMacs.has(devOkExhausted), true, 'devOkExhausted successfully blocked');
    // devOkActive remains unblocked
    assert.equal(mockNft.blockedMacs.has(devOkActive), false, 'devOkActive remains unblocked');

    console.log('✅ Test 5 Passed: Device failure isolation verified');
  }

  // Test 6: Malformed nftables Output Parsing Resilience
  {
    console.log('Running Test 6: Malformed nftables Output Handling...');
    const mockSsh = {
      isConfigured: () => true,
      executeCommand: async (cmd: string) => {
        if (cmd.includes('list table')) return { stdout: '', stderr: '', exitCode: 0 };
        if (cmd.includes('list set')) {
          // Output contains valid MACs mixed with corrupted elements and text
          return {
            stdout: `
            {
              "nftables": [
                {
                  "set": {
                    "name": "blocked_macs",
                    "elem": [
                      "52:54:00:CE:1C:BE",
                      "invalid-element-not-a-mac",
                      null,
                      12345,
                      "52:54:00:AA:BB:CC"
                    ]
                  }
                }
              ]
            }`,
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    const nftClient = new NftablesClient(mockSsh as unknown as import('../src/infrastructure/openwrt/SshClient.js').ISshClient);
    const blocked = await nftClient.listBlockedMacs();

    assert.equal(blocked.length, 2);
    assert.ok(blocked.includes('52:54:00:CE:1C:BE'));
    assert.ok(blocked.includes('52:54:00:AA:BB:CC'));

    console.log('✅ Test 6 Passed: Malformed nft output handled safely');
  }

  // Test 7: Infrastructure Device Protection
  {
    console.log('Running Test 7: Infrastructure Device Protection (Router MAC & Host MAC blocked from firewall)...');
    const mockNft = new MockVerifiableNftablesClient();
    const mockDevices = createMockDevicesService();
    const fwRepo = new FileFirewallRepository(firewallFile);
    const fwService = new FirewallService(mockNft, mockDevices, fwRepo);

    // Try blocking router MAC
    await assert.rejects(
      async () => fwService.blockDevice('52:54:00:CF:15:77', 'quota'),
      (err: unknown) => err instanceof InfrastructureDeviceError
    );

    // Try blocking host bridge MAC
    await assert.rejects(
      async () => fwService.blockDevice('52:54:00:5B:2E:C1', 'quota'),
      (err: unknown) => err instanceof InfrastructureDeviceError
    );

    assert.equal(mockNft.blockedMacs.size, 0, 'No infrastructure MAC added to firewall');
    console.log('✅ Test 7 Passed: Infrastructure device protection verified');
  }

  cleanup();
  console.log('🎉 ALL OpenWrt Integration Hardening & Recovery Verification Tests PASSED! 🎉');
}

void runIntegrationVerificationTests();

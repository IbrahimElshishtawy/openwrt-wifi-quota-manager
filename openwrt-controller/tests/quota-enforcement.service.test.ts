import assert from 'node:assert/strict';
import { QuotaEnforcementService } from '../src/modules/quota-enforcement/QuotaEnforcementService.js';
import type { DeviceQuota } from '../src/modules/quota/types.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { InMemoryFirewallRepository } from '../src/modules/firewall/storage/InMemoryFirewallRepository.js';
import type { INftablesClient } from '../src/modules/firewall/NftablesClient.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { InfrastructureMetadata, Device } from '../src/modules/devices/types.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { InMemoryQuotaRepository } from '../src/modules/quota/storage/InMemoryQuotaRepository.js';
import type { UsageService } from '../src/modules/usage/UsageService.js';
import { UsageFetchError, type DeviceUsage } from '../src/modules/usage/types.js';

// Setup Mock environment for Firewall and Quota services
function createMockEnvironment() {
  const blockedNftElements = new Set<string>();
  const executedNftCommands: string[] = [];

  const mockNftables: INftablesClient = {
    ensureRuleset: async () => {},
    addBlockedMac: async (mac: string) => {
      executedNftCommands.push(`add ${mac}`);
      blockedNftElements.add(mac.toUpperCase());
    },
    deleteBlockedMac: async (mac: string) => {
      executedNftCommands.push(`delete ${mac}`);
      blockedNftElements.delete(mac.toUpperCase());
    },
    hasBlockedMac: async (mac: string) => {
      return blockedNftElements.has(mac.toUpperCase());
    },
    listBlockedMacs: async () => {
      return Array.from(blockedNftElements);
    },
  };

  const infra: InfrastructureMetadata = {
    excludedIps: new Set(['192.168.50.1']),
    excludedMacs: new Set(['52:54:00:CF:15:77']),
    excludedHostnames: new Set(['openwrt']),
    wanDevices: new Set(['eth1']),
    lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
  };

  const mockDevicesService = {
    detectInfrastructure: async () => infra,
    getConnectedDevices: async () => [
      { id: '52:54:00:AA:AA:AA', mac: '52:54:00:AA:AA:AA', ip: '192.168.50.10', connected: true },
      { id: '52:54:00:BB:BB:BB', mac: '52:54:00:BB:BB:BB', ip: '192.168.50.20', connected: true },
      { id: '52:54:00:CC:CC:CC', mac: '52:54:00:CC:CC:CC', ip: '192.168.50.30', connected: true },
      { id: '52:54:00:CE:1C:BE', mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', connected: true },
    ] as Device[],
    isRealLanClient: () => true,
  } as unknown as DevicesService;

  const firewallRepo = new InMemoryFirewallRepository();
  const firewallService = new FirewallService(mockNftables, mockDevicesService, firewallRepo);

  const silentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  return {
    blockedNftElements,
    executedNftCommands,
    mockNftables,
    mockDevicesService,
    firewallRepo,
    firewallService,
    silentLogger,
  };
}

async function runEnforcementServiceTests() {
  console.log('🧪 Starting QuotaEnforcementService Unit Tests (All 11 Minimum Specs)...');

  // Test 1: Active quota + device not blocked -> remains unblocked
  {
    console.log('Running Test 1: Active quota + device not blocked remains unblocked...');
    const env = createMockEnvironment();

    const activeQuota: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 1000000,
      usedBytes: 500000,
      remainingBytes: 500000,
      percentage: 50,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [activeQuota],
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    const result = await enforcementService.enforceAll();

    assert.equal(result.totalEvaluated, 1);
    assert.equal(result.blockedCount, 0);
    assert.equal(result.unblockedCount, 0);
    assert.equal(result.unchangedCount, 1);
    assert.equal(result.results[0]?.action, 'none');
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE'), false);
    console.log('✅ Test 1 Passed: Device with active quota remains unblocked');
  }

  // Test 2: Exhausted quota + device not blocked -> blockDevice(mac)
  {
    console.log('Running Test 2: Exhausted quota + device not blocked -> blockDevice(mac)...');
    const env = createMockEnvironment();

    const exhaustedQuota: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 1000000,
      usedBytes: 1000000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [exhaustedQuota],
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    const result = await enforcementService.enforceAll();

    assert.equal(result.totalEvaluated, 1);
    assert.equal(result.blockedCount, 1);
    assert.equal(result.results[0]?.action, 'blocked');
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE'), true);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE', 'quota'), true);
    console.log('✅ Test 2 Passed: Exhausted quota triggers blockDevice successfully');
  }

  // Test 3: Exhausted quota + already quota-blocked -> no duplicate block
  {
    console.log('Running Test 3: Exhausted quota + already quota-blocked -> no duplicate block...');
    const env = createMockEnvironment();

    const exhaustedQuota: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 1000000,
      usedBytes: 1200000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Pre-block the device as quota-blocked
    await env.firewallService.blockDevice('52:54:00:CE:1C:BE', 'quota');
    env.executedNftCommands.length = 0; // reset command log

    const mockQuotaService = {
      refreshAllQuotas: async () => [exhaustedQuota],
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    const result = await enforcementService.enforceAll();

    assert.equal(result.totalEvaluated, 1);
    assert.equal(result.blockedCount, 0);
    assert.equal(result.unchangedCount, 1);
    assert.equal(result.results[0]?.action, 'none');
    // Ensure no additional nft command was executed
    assert.equal(env.executedNftCommands.length, 0);
    console.log('✅ Test 3 Passed: Idempotent - no duplicate block command issued');
  }

  // Test 4: Quota transitions: active -> exhausted: verify the block happens
  {
    console.log('Running Test 4: Quota transitions active -> exhausted...');
    const env = createMockEnvironment();

    let quotaStatus: 'active' | 'exhausted' = 'active';
    let usedBytes = 500000;

    const mockQuotaService = {
      refreshAllQuotas: async () => [
        {
          mac: '52:54:00:CE:1C:BE',
          quotaBytes: 1000000,
          usedBytes,
          remainingBytes: Math.max(0, 1000000 - usedBytes),
          percentage: (usedBytes / 1000000) * 100,
          status: quotaStatus,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as DeviceQuota,
      ],
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    // Cycle 1: Active
    const res1 = await enforcementService.enforceAll();
    assert.equal(res1.blockedCount, 0);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE'), false);

    // Transition to exhausted
    quotaStatus = 'exhausted';
    usedBytes = 1000000;

    // Cycle 2: Exhausted
    const res2 = await enforcementService.enforceAll();
    assert.equal(res2.blockedCount, 1);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE'), true);
    console.log('✅ Test 4 Passed: Transition from active to exhausted blocks device');
  }

  // Test 5: Quota transitions: exhausted -> active: verify only quota-owned block is removed
  {
    console.log('Running Test 5: Quota transitions exhausted -> active removes quota block...');
    const env = createMockEnvironment();

    let quotaStatus: 'active' | 'exhausted' = 'exhausted';

    const mockQuotaService = {
      refreshAllQuotas: async () => [
        {
          mac: '52:54:00:CE:1C:BE',
          quotaBytes: 1000000,
          usedBytes: quotaStatus === 'exhausted' ? 1000000 : 0,
          remainingBytes: quotaStatus === 'exhausted' ? 0 : 1000000,
          percentage: quotaStatus === 'exhausted' ? 100 : 0,
          status: quotaStatus,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as DeviceQuota,
      ],
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    // Cycle 1: Block when exhausted
    await enforcementService.enforceAll();
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE'), true);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE', 'quota'), true);

    // Transition to active
    quotaStatus = 'active';

    // Cycle 2: Unblock when active
    const res2 = await enforcementService.enforceAll();
    assert.equal(res2.unblockedCount, 1);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE'), false);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CE:1C:BE', 'quota'), false);
    console.log('✅ Test 5 Passed: Transition from exhausted to active unblocks quota-owned block');
  }

  // Test 6: Quota increased after exhaustion: 5 GB exhausted -> admin increases to 10 GB -> active -> quota block removed
  {
    console.log('Running Test 6: Quota increased after exhaustion end-to-end...');
    const env = createMockEnvironment();

    const quotaRepo = new InMemoryQuotaRepository();
    const mac = '52:54:00:CE:1C:BE';

    const currentUsage: DeviceUsage[] = [{ mac, ip: '192.168.50.50', rxBytes: 2500000000, txBytes: 2500000000, totalBytes: 5000000000 }];
    const usageServiceMock = {
      getDeviceUsage: async () => currentUsage,
    } as unknown as UsageService;

    const realQuotaService = new QuotaService(quotaRepo, usageServiceMock, env.mockDevicesService);

    // Create 5GB quota with 0 initial baseline
    await realQuotaService.createQuota({ mac, quotaBytes: 5000000000 });

    const enforcementService = new QuotaEnforcementService(
      realQuotaService,
      env.firewallService,
      env.silentLogger
    );

    // Exhaust quota by generating 5GB usage delta
    currentUsage[0]!.totalBytes += 5000000000;
    const cycle1 = await enforcementService.enforceAll();
    assert.equal(cycle1.blockedCount, 1);
    assert.equal(await env.firewallService.isBlocked(mac), true);

    // Admin increases quota to 10GB
    await realQuotaService.updateQuota(mac, { quotaBytes: 10000000000 });

    // Next cycle: quota is now active
    const cycle2 = await enforcementService.enforceAll();
    assert.equal(cycle2.unblockedCount, 1);
    assert.equal(await env.firewallService.isBlocked(mac), false);
    console.log('✅ Test 6 Passed: Quota limit increase restores device access');
  }

  // Test 7: Usage reset: exhausted -> resetUsage -> active -> unblock quota-owned block
  {
    console.log('Running Test 7: Usage reset restores device access...');
    const env = createMockEnvironment();

    const quotaRepo = new InMemoryQuotaRepository();
    const mac = '52:54:00:CE:1C:BE';

    const currentUsage: DeviceUsage[] = [{ mac, ip: '192.168.50.50', rxBytes: 500000, txBytes: 500000, totalBytes: 1000000 }];
    const usageServiceMock = {
      getDeviceUsage: async () => currentUsage,
    } as unknown as UsageService;

    const realQuotaService = new QuotaService(quotaRepo, usageServiceMock, env.mockDevicesService);

    await realQuotaService.createQuota({ mac, quotaBytes: 1000000 });

    const enforcementService = new QuotaEnforcementService(
      realQuotaService,
      env.firewallService,
      env.silentLogger
    );

    // Consume full quota
    currentUsage[0]!.totalBytes += 1000000;
    await enforcementService.enforceAll();
    assert.equal(await env.firewallService.isBlocked(mac), true);

    // Admin resets usage
    await realQuotaService.updateQuota(mac, { resetUsage: true });

    // Next cycle restores access
    const cycle = await enforcementService.enforceAll();
    assert.equal(cycle.unblockedCount, 1);
    assert.equal(await env.firewallService.isBlocked(mac), false);
    console.log('✅ Test 7 Passed: Usage reset restores device access');
  }

  // Test 8: Router failure: UsageService throws -> monitor does not crash -> next cycle can run
  {
    console.log('Running Test 8: Router failure does not crash enforcement service...');
    const env = createMockEnvironment();

    let failRouter = true;
    const mockQuotaService = {
      refreshAllQuotas: async () => {
        if (failRouter) {
          throw new UsageFetchError('SSH connection to router 192.168.50.1 timed out', new Error('Timeout'));
        }
        return [
          {
            mac: '52:54:00:CE:1C:BE',
            quotaBytes: 1000,
            usedBytes: 100,
            remainingBytes: 900,
            percentage: 10,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as DeviceQuota,
        ];
      },
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    // Failed cycle
    const failedResult = await enforcementService.enforceAll();
    assert.equal(failedResult.success, false);
    assert.match(failedResult.error ?? '', /Router\/Usage refresh failure/);

    // Recover router on next cycle
    failRouter = false;
    const okResult = await enforcementService.enforceAll();
    assert.equal(okResult.success, true);
    assert.equal(okResult.totalEvaluated, 1);
    console.log('✅ Test 8 Passed: Router failure handled gracefully without crashing');
  }

  // Test 9: Firewall failure: blockDevice throws -> other devices are still processed
  {
    console.log('Running Test 9: Firewall failure on one device isolates error...');
    const env = createMockEnvironment();

    const quotas: DeviceQuota[] = [
      { mac: '52:54:00:AA:AA:AA', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' },
      { mac: '52:54:00:BB:BB:BB', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' },
      { mac: '52:54:00:CC:CC:CC', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' },
    ];

    const mockQuotaService = {
      refreshAllQuotas: async () => quotas,
    } as unknown as QuotaService;

    // Fail only for device BB:BB:BB
    const originalBlock = env.firewallService.blockDevice.bind(env.firewallService);
    env.firewallService.blockDevice = async (mac: string, source: 'manual' | 'quota' = 'manual') => {
      if (mac === '52:54:00:BB:BB:BB') {
        throw new Error('NFT element addition failed for device BB:BB:BB');
      }
      return originalBlock(mac, source);
    };

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    const result = await enforcementService.enforceAll();

    assert.equal(result.totalEvaluated, 3);
    assert.equal(result.blockedCount, 2); // AA and CC blocked
    assert.equal(result.errorCount, 1); // BB failed
    assert.equal(result.success, false);

    assert.equal(await env.firewallService.isBlocked('52:54:00:AA:AA:AA'), true);
    assert.equal(await env.firewallService.isBlocked('52:54:00:BB:BB:BB'), false);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CC:CC:CC'), true);
    console.log('✅ Test 9 Passed: Single device firewall error isolated from other devices');
  }

  // Test 10: Multiple quotas: A exhausted, B active, C exhausted -> A blocked, B allowed, C blocked
  {
    console.log('Running Test 10: Multiple quotas evaluation...');
    const env = createMockEnvironment();

    const quotas: DeviceQuota[] = [
      { mac: '52:54:00:AA:AA:AA', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' },
      { mac: '52:54:00:BB:BB:BB', quotaBytes: 100, usedBytes: 50, remainingBytes: 50, percentage: 50, status: 'active', createdAt: '', updatedAt: '' },
      { mac: '52:54:00:CC:CC:CC', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' },
    ];

    const mockQuotaService = {
      refreshAllQuotas: async () => quotas,
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    const result = await enforcementService.enforceAll();

    assert.equal(result.blockedCount, 2);
    assert.equal(result.unchangedCount, 1);
    assert.equal(await env.firewallService.isBlocked('52:54:00:AA:AA:AA'), true);
    assert.equal(await env.firewallService.isBlocked('52:54:00:BB:BB:BB'), false);
    assert.equal(await env.firewallService.isBlocked('52:54:00:CC:CC:CC'), true);
    console.log('✅ Test 10 Passed: Multiple quotas correctly evaluated');
  }

  // Test 11: Manual block protection: manual block exists, quota active -> monitor must NOT remove manual block
  {
    console.log('Running Test 11: Manual block protection...');
    const env = createMockEnvironment();

    const mac = '52:54:00:CE:1C:BE';

    // Admin manually blocks device
    await env.firewallService.blockDevice(mac, 'manual');
    assert.equal(await env.firewallService.isBlocked(mac), true);
    assert.equal(await env.firewallService.isBlocked(mac, 'manual'), true);
    assert.equal(await env.firewallService.isBlocked(mac, 'quota'), false);

    // Device quota is active
    const activeQuota: DeviceQuota = {
      mac,
      quotaBytes: 5000000,
      usedBytes: 1000,
      remainingBytes: 4999000,
      percentage: 0.02,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [activeQuota],
    } as unknown as QuotaService;

    const enforcementService = new QuotaEnforcementService(
      mockQuotaService,
      env.firewallService,
      env.silentLogger
    );

    const result = await enforcementService.enforceAll();

    // Verify monitor did not remove the block
    assert.equal(result.unblockedCount, 0);
    assert.equal(result.unchangedCount, 1);
    assert.equal(await env.firewallService.isBlocked(mac), true);
    assert.equal(await env.firewallService.isBlocked(mac, 'manual'), true);
    console.log('✅ Test 11 Passed: Manual firewall block strictly protected from quota unblock');
  }

  console.log('\n🎉 ALL QuotaEnforcementService TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runEnforcementServiceTests();

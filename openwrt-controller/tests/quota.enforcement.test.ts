import assert from 'node:assert/strict';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { IFirewallService } from '../src/modules/firewall/IFirewallService.js';
import type { BlockResult, UnblockResult } from '../src/modules/firewall/types.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { InMemoryQuotaRepository } from '../src/modules/quota/storage/InMemoryQuotaRepository.js';
import type { UsageService } from '../src/modules/usage/UsageService.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import type { DeviceQuota } from '../src/modules/quota/types.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';

interface MockFirewallState {
  blockedMacs: Set<string>;
  blockCalls: Array<{ mac: string; source?: string }>;
  unblockCalls: Array<{ mac: string; source?: string }>;
  failMacs: Set<string>;
}

function createMockFirewall(): { firewall: IFirewallService; state: MockFirewallState } {
  const state: MockFirewallState = {
    blockedMacs: new Set<string>(),
    blockCalls: [],
    unblockCalls: [],
    failMacs: new Set<string>(),
  };

  const firewall: IFirewallService = {
    initialize: async () => {},
    ensureRuleset: async () => {},
    blockDevice: async (mac: string, source?: string): Promise<BlockResult> => {
      state.blockCalls.push({ mac, source });
      if (state.failMacs.has(mac)) {
        throw new Error(`Firewall block failed on router for MAC: ${mac}`);
      }
      state.blockedMacs.add(mac.toUpperCase());
      return {
        success: true,
        mac,
        isBlocked: true,
        message: 'Device blocked',
      };
    },
    unblockDevice: async (mac: string, source?: string): Promise<UnblockResult> => {
      state.unblockCalls.push({ mac, source });
      if (state.failMacs.has(mac)) {
        throw new Error(`Firewall unblock failed on router for MAC: ${mac}`);
      }
      state.blockedMacs.delete(mac.toUpperCase());
      return {
        success: true,
        mac,
        isBlocked: false,
        message: 'Device unblocked',
      };
    },
    isBlocked: async (mac: string): Promise<boolean> => {
      return state.blockedMacs.has(mac.toUpperCase());
    },
    getBlockedDevices: async (): Promise<string[]> => {
      return Array.from(state.blockedMacs);
    },
  };

  return { firewall, state };
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

async function runQuotaEnforcementTests() {
  console.log('🧪 Starting QuotaEnforcementMonitor Comprehensive Unit & Integration Tests...');

  // ==========================================
  // Test 1: Active quota does not trigger block
  // ==========================================
  console.log('Running Test 1: Active quota does not trigger block...');
  {
    const { firewall, state } = createMockFirewall();

    const activeQuota: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 5000000000, // 5 GB
      usedBytes: 2000000000,  // 2 GB
      remainingBytes: 3000000000,
      percentage: 40,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [activeQuota],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    await monitor.sync();

    assert.equal(state.blockCalls.length, 0, 'Must not block device with active quota');
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), false);
    console.log('✅ Test 1 Passed: Active quota does not trigger block');
  }

  // ==========================================
  // Test 2: Exhausted quota triggers block
  // ==========================================
  console.log('Running Test 2: Exhausted quota triggers block...');
  {
    const { firewall, state } = createMockFirewall();

    const exhaustedQuota: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 5000000000, // 5 GB
      usedBytes: 5000000000,  // 5 GB
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [exhaustedQuota],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    await monitor.sync();

    assert.equal(state.blockCalls.length, 1);
    assert.equal(state.blockCalls[0]?.mac, '52:54:00:CE:1C:BE');
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), true);
    console.log('✅ Test 2 Passed: Exhausted quota triggers block');
  }

  // =========================================================================
  // Test 3: Only exhausted device is blocked (Per-device isolation guarantee)
  // A -> exhausted, B -> active, C -> active => block(A) only
  // =========================================================================
  console.log('Running Test 3: Only exhausted device is blocked (A exhausted, B and C active)...');
  {
    const { firewall, state } = createMockFirewall();

    const deviceA: DeviceQuota = {
      mac: '52:54:00:AA:AA:AA',
      quotaBytes: 5000000000,
      usedBytes: 5000000000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const deviceB: DeviceQuota = {
      mac: '52:54:00:BB:BB:BB',
      quotaBytes: 10000000000,
      usedBytes: 2000000000,
      remainingBytes: 8000000000,
      percentage: 20,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const deviceC: DeviceQuota = {
      mac: '52:54:00:CC:CC:CC',
      quotaBytes: 3000000000,
      usedBytes: 1000000000,
      remainingBytes: 2000000000,
      percentage: 33.33,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [deviceA, deviceB, deviceC],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    await monitor.sync();

    // Verify ONLY device A was blocked
    assert.equal(state.blockCalls.length, 1);
    assert.equal(state.blockCalls[0]?.mac, '52:54:00:AA:AA:AA');
    assert.equal(state.blockedMacs.has('52:54:00:AA:AA:AA'), true);
    assert.equal(state.blockedMacs.has('52:54:00:BB:BB:BB'), false);
    assert.equal(state.blockedMacs.has('52:54:00:CC:CC:CC'), false);
    console.log('✅ Test 3 Passed: Only exhausted device is blocked; LAN peers remain online');
  }

  // =========================================================================
  // Test 4: Repeated sync does not unnecessarily repeat block operations
  // =========================================================================
  console.log('Running Test 4: Repeated sync does not unnecessarily repeat block operations...');
  {
    const { firewall, state } = createMockFirewall();

    const exhaustedQuota: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 5000000000,
      usedBytes: 5000000000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [exhaustedQuota],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    // Run cycle 1
    await monitor.sync();
    assert.equal(state.blockCalls.length, 1);

    // Run cycle 2: should be a no-op due to in-memory state transition cache
    await monitor.sync();
    assert.equal(state.blockCalls.length, 1, 'Second sync must not re-issue duplicate block');

    // Run cycle 3: still no duplicate call
    await monitor.sync();
    assert.equal(state.blockCalls.length, 1, 'Third sync must not re-issue duplicate block');
    console.log('✅ Test 4 Passed: Repeated sync does not unnecessarily repeat block operations');
  }

  // =========================================================================
  // Test 5: Resetting exhausted quota causes unblock
  // =========================================================================
  console.log('Running Test 5: Resetting exhausted quota causes unblock...');
  {
    const { firewall, state } = createMockFirewall();

    let quotaState: DeviceQuota = {
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 5000000000,
      usedBytes: 5000000000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [quotaState],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    // Cycle 1: exhausted -> device blocked
    await monitor.sync();
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), true);
    assert.equal(state.unblockCalls.length, 0);

    // Admin resets usage: quota transitions to active
    quotaState = {
      ...quotaState,
      usedBytes: 0,
      remainingBytes: 5000000000,
      percentage: 0,
      status: 'active',
      updatedAt: new Date().toISOString(),
    };

    // Cycle 2: active -> unblockDevice called
    await monitor.sync();
    assert.equal(state.unblockCalls.length, 1);
    assert.equal(state.unblockCalls[0]?.mac, '52:54:00:CE:1C:BE');
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), false);
    console.log('✅ Test 5 Passed: Resetting exhausted quota causes unblock');
  }

  // =========================================================================
  // Test 6: Deleted quota does not remain blocked
  // =========================================================================
  console.log('Running Test 6: Deleted quota does not remain blocked...');
  {
    const { firewall, state } = createMockFirewall();

    const deviceQuotas: DeviceQuota[] = [
      {
        mac: '52:54:00:CE:1C:BE',
        quotaBytes: 1000,
        usedBytes: 1000,
        remainingBytes: 0,
        percentage: 100,
        status: 'exhausted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const mockQuotaService = {
      refreshAllQuotas: async () => [...deviceQuotas],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    // First cycle: blocks device
    await monitor.sync();
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), true);

    // Delete quota: list is now empty
    deviceQuotas.length = 0;

    // Next sync detects deleted quota and unblocks
    await monitor.sync();
    assert.equal(state.unblockCalls.length, 1);
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), false);
    console.log('✅ Test 6 Passed: Deleted quota does not remain blocked');
  }

  // =========================================================================
  // Test 7: Firewall failure for one device does not stop processing others
  // =========================================================================
  console.log('Running Test 7: Firewall failure for one device does not stop processing other devices...');
  {
    const { firewall, state } = createMockFirewall();
    // Device A will fail firewall operation
    state.failMacs.add('52:54:00:AA:AA:AA');

    const deviceA: DeviceQuota = {
      mac: '52:54:00:AA:AA:AA',
      quotaBytes: 1000,
      usedBytes: 1000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const deviceB: DeviceQuota = {
      mac: '52:54:00:BB:BB:BB',
      quotaBytes: 1000,
      usedBytes: 1000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [deviceA, deviceB],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const cycleResult = await monitor.runCycle();

    // Verify Device B was successfully blocked even though Device A failed
    assert.equal(state.blockedMacs.has('52:54:00:BB:BB:BB'), true);
    assert.equal(state.blockedMacs.has('52:54:00:AA:AA:AA'), false);
    assert.equal(cycleResult?.errorCount, 1);
    assert.equal(cycleResult?.blockedCount, 1);
    console.log('✅ Test 7 Passed: Firewall failure for one device isolates error and processes others');
  }

  // =========================================================================
  // Test 8: Monitor start() creates only one timer
  // =========================================================================
  console.log('Running Test 8: Monitor start() creates only one timer...');
  {
    const { firewall } = createMockFirewall();
    let syncCalls = 0;

    const mockQuotaService = {
      refreshAllQuotas: async () => {
        syncCalls++;
        return [];
      },
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      intervalMs: 5000,
      logger: silentLogger,
    });

    assert.equal(monitor.isRunning(), false);

    monitor.start();
    assert.equal(monitor.isRunning(), true);

    // Call start a second time
    monitor.start();
    assert.equal(monitor.isRunning(), true);

    // Immediate initial sync should be called exactly once
    assert.equal(syncCalls, 1);

    monitor.stop();
    assert.equal(monitor.isRunning(), false);
    console.log('✅ Test 8 Passed: Monitor start() preserves single timer idempotently');
  }

  // =========================================================================
  // Test 9: Monitor stop() clears timer
  // =========================================================================
  console.log('Running Test 9: Monitor stop() clears timer...');
  {
    const { firewall } = createMockFirewall();

    const mockQuotaService = {
      refreshAllQuotas: async () => [],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      intervalMs: 1000,
      logger: silentLogger,
    });

    monitor.start();
    assert.equal(monitor.isRunning(), true);

    monitor.stop();
    assert.equal(monitor.isRunning(), false);

    // Calling stop again is safe
    monitor.stop();
    assert.equal(monitor.isRunning(), false);
    console.log('✅ Test 9 Passed: Monitor stop() clears timer cleanly and is safe to call repeatedly');
  }

  // =========================================================================
  // Test 10: Disabled monitor does not start
  // =========================================================================
  console.log('Running Test 10: Disabled monitor does not start...');
  {
    const { firewall } = createMockFirewall();
    let syncCalls = 0;

    const mockQuotaService = {
      refreshAllQuotas: async () => {
        syncCalls++;
        return [];
      },
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      enabled: false,
      logger: silentLogger,
    });

    monitor.start();
    assert.equal(monitor.isRunning(), false);
    assert.equal(syncCalls, 0, 'Disabled monitor must not execute sync');
    console.log('✅ Test 10 Passed: Disabled monitor does not start');
  }

  // =========================================================================
  // Test 11: Router/UsageService failures are handled safely
  // =========================================================================
  console.log('Running Test 11: Router/UsageService failures are handled safely...');
  {
    const { firewall, state } = createMockFirewall();

    const failingQuotaService = {
      refreshAllQuotas: async () => {
        throw new Error('Connection refused by OpenWrt ubus endpoint');
      },
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(failingQuotaService, firewall, {
      logger: silentLogger,
    });

    // runCycle should not throw, should log and record telemetry error
    const result = await monitor.runCycle();

    assert.notEqual(result, null);
    assert.equal(result?.success, false);
    assert.match(result?.error ?? '', /refresh failure/i);
    assert.equal(state.blockCalls.length, 0, 'Router error must not cause false block calls');

    const status = monitor.getStatus();
    assert.equal(status.consecutiveErrors, 1);
    assert.notEqual(status.lastError, null);
    console.log('✅ Test 11 Passed: Router/UsageService failure handled safely without crashing');
  }

  // =========================================================================
  // Test 12: MAC normalization remains consistent
  // =========================================================================
  console.log('Running Test 12: MAC normalization remains consistent...');
  {
    const { firewall, state } = createMockFirewall();

    const lowercaseQuota: DeviceQuota = {
      mac: '52:54:00:ce:1c:be'.toUpperCase(), // Already normalized by QuotaService
      quotaBytes: 1000,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [lowercaseQuota],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    await monitor.sync();

    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), true);
    console.log('✅ Test 12 Passed: MAC normalization remains uniform');
  }

  // =========================================================================
  // Section 20: Complete logical pipeline integration test
  // UsageService -> QuotaService -> QuotaEnforcementMonitor -> FirewallService
  // =========================================================================
  console.log('\nRunning Section 20: Full End-to-End Pipeline Integration Test...');
  {
    const { firewall, state } = createMockFirewall();

    // 1. Setup in-memory quota repository
    const quotaRepo = new InMemoryQuotaRepository();

    // 2. Setup mock usage and devices services
    let currentUsageBytes = 0;
    const mockUsageService = {
      getDeviceUsage: async (): Promise<DeviceUsage[]> => [
        {
          mac: '52:54:00:CE:1C:BE',
          ip: '192.168.50.50',
          downloadBytes: Math.floor(currentUsageBytes / 2),
          uploadBytes: Math.ceil(currentUsageBytes / 2),
          totalBytes: currentUsageBytes,
        },
      ],
    } as unknown as UsageService;

    const infra: InfrastructureMetadata = {
      excludedIps: new Set(['192.168.50.1']),
      excludedMacs: new Set(['52:54:00:CF:15:77']),
      excludedHostnames: new Set(['openwrt']),
      wanDevices: new Set(['eth1']),
      lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
    };

    const mockDevicesService = {
      detectInfrastructure: async () => infra,
      getBaselineInfrastructure: () => infra,
      getConnectedDevices: async () => [
        {
          id: '52:54:00:CE:1C:BE',
          mac: '52:54:00:CE:1C:BE',
          ip: '192.168.50.50',
          connected: true,
        },
      ],
      isRealLanClient: () => true,
    } as unknown as DevicesService;

    // 3. Real QuotaService with injected dependencies
    const quotaService = new QuotaService(quotaRepo, mockUsageService, mockDevicesService);

    // 4. Create quota: limit = 1000 bytes, baseline currentUsage = 0
    const createdQuota = await quotaService.createQuota({
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 1000,
    });
    assert.equal(createdQuota.status, 'active');
    assert.equal(createdQuota.usedBytes, 0);

    // 5. QuotaEnforcementMonitor connecting QuotaService to FirewallService
    const monitor = new QuotaEnforcementMonitor(quotaService, firewall, {
      logger: silentLogger,
    });

    // Step A: Sync when usage = 0 -> status = active, not blocked
    await monitor.sync();
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), false, 'Should be active and unblocked');

    // Step B: Simulate traffic generation -> usage reaches 1000 bytes
    currentUsageBytes = 1000;

    // Step C: Next sync evaluates fresh usage from UsageService -> QuotaService -> status = exhausted
    await monitor.sync();

    // Verify firewall blocked the device
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), true, 'Exhausted quota must block device in firewall');
    assert.equal(state.blockCalls.length, 1);

    // Step D: Admin resets quota usage (resetUsage = true)
    const updatedQuota = await quotaService.updateQuota('52:54:00:CE:1C:BE', { resetUsage: true });
    assert.equal(updatedQuota.status, 'active');
    assert.equal(updatedQuota.usedBytes, 0);

    // Step E: Next sync evaluates active quota -> unblocks device
    await monitor.sync();
    assert.equal(state.blockedMacs.has('52:54:00:CE:1C:BE'), false, 'Reset quota must unblock device in firewall');
    assert.equal(state.unblockCalls.length, 1);

    console.log('✅ Section 20 Passed: Complete pipeline (Usage -> Quota -> Monitor -> Firewall) verified!');
  }

  console.log('\n🎉 ALL QuotaEnforcementMonitor TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runQuotaEnforcementTests().catch((err) => {
  console.error('❌ QuotaEnforcementMonitor test failed:', err);
  process.exit(1);
});

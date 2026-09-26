import assert from 'node:assert/strict';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import type { IFirewallService } from '../src/modules/firewall/IFirewallService.js';
import type { BlockResult, UnblockResult } from '../src/modules/firewall/types.js';
import type { QuotaService } from '../src/modules/quota/QuotaService.js';
import type { DeviceQuota } from '../src/modules/quota/types.js';

interface MockFirewallState {
  blockedMacs: Set<string>;
  blockCalls: Array<{ mac: string; source?: string }>;
  unblockCalls: Array<{ mac: string; source?: string }>;
  failMacs: Set<string>;
  sources: Map<string, Set<string>>;
}

function createMockFirewall(): { firewall: IFirewallService; state: MockFirewallState } {
  const state: MockFirewallState = {
    blockedMacs: new Set<string>(),
    blockCalls: [],
    unblockCalls: [],
    failMacs: new Set<string>(),
    sources: new Map<string, Set<string>>(),
  };

  const firewall: IFirewallService = {
    initialize: async () => {},
    ensureRuleset: async () => {},
    blockDevice: async (mac: string, source: string = 'manual'): Promise<BlockResult> => {
      state.blockCalls.push({ mac, source });
      const norm = mac.toUpperCase();
      if (state.failMacs.has(norm)) {
        throw new Error(`Firewall element addition failure on router for MAC: ${norm}`);
      }
      let srcSet = state.sources.get(norm);
      if (!srcSet) {
        srcSet = new Set();
        state.sources.set(norm, srcSet);
      }
      srcSet.add(source);
      state.blockedMacs.add(norm);
      return {
        success: true,
        mac: norm,
        isBlocked: true,
        message: 'Device blocked in nftables',
      };
    },
    unblockDevice: async (mac: string, source: string = 'manual'): Promise<UnblockResult> => {
      state.unblockCalls.push({ mac, source });
      const norm = mac.toUpperCase();
      if (state.failMacs.has(norm)) {
        throw new Error(`Firewall element deletion failure on router for MAC: ${norm}`);
      }
      const srcSet = state.sources.get(norm);
      const hasManual = srcSet?.has('manual') ?? false;

      // If quota unblocks but device has active manual block, preserve manual block
      if (source === 'quota' && hasManual) {
        srcSet?.delete('quota');
        return {
          success: true,
          mac: norm,
          isBlocked: true,
          message: 'Quota block removed, manual block remains',
          wasBlocked: true,
        };
      }

      if (srcSet) {
        srcSet.delete(source);
        if (srcSet.size === 0) {
          state.blockedMacs.delete(norm);
        }
      } else {
        // Orphan block in nftables with no recorded sources
        state.blockedMacs.delete(norm);
      }

      return {
        success: true,
        mac: norm,
        isBlocked: state.blockedMacs.has(norm),
        message: 'Device unblocked from nftables',
        wasBlocked: true,
      };
    },
    isBlocked: async (mac: string, source?: string): Promise<boolean> => {
      const norm = mac.toUpperCase();
      if (source) {
        return state.sources.get(norm)?.has(source) ?? false;
      }
      return state.blockedMacs.has(norm);
    },
    getBlockedDevices: async (source?: string): Promise<string[]> => {
      if (source) {
        return Array.from(state.sources.entries())
          .filter(([_, set]) => set.has(source))
          .map(([mac]) => mac);
      }
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

async function runReconciliationTests() {
  console.log('🧪 Starting Quota Enforcement Recovery & Reconciliation Tests (All 12 Specs)...\n');

  // =========================================================================
  // Spec 1: Startup recovery - Exhausted quota + missing firewall block -> block
  // =========================================================================
  {
    console.log('Running Spec 1: Exhausted quota + missing firewall block -> block...');
    const { firewall, state } = createMockFirewall();

    const exhaustedQuota: DeviceQuota = {
      mac: '52:54:00:AA:11:11',
      quotaBytes: 100000,
      usedBytes: 150000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [exhaustedQuota],
    } as unknown as QuotaService;

    // Controller starts up: empty in-memory cache
    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    assert.equal(state.blockedMacs.has('52:54:00:AA:11:11'), false, 'Initial firewall state is unblocked');

    const result = await monitor.runCycle();

    assert.equal(result?.blockedCount, 1, 'Should block 1 device');
    assert.equal(state.blockedMacs.has('52:54:00:AA:11:11'), true, 'Device must be blocked in nftables');
    assert.equal(state.blockCalls.length, 1);
    assert.equal(state.blockCalls[0]?.source, 'quota');
    console.log('✅ Spec 1 Passed: Controller startup blocks exhausted quota with missing firewall block');
  }

  // =========================================================================
  // Spec 2: Startup recovery - Exhausted quota + existing firewall block -> no duplicate block
  // =========================================================================
  {
    console.log('Running Spec 2: Exhausted quota + existing firewall block -> no duplicate block...');
    const { firewall, state } = createMockFirewall();
    const mac = '52:54:00:BB:22:22';

    // Pre-populate firewall: device was already blocked by quota prior to controller startup
    await firewall.blockDevice(mac, 'quota');
    state.blockCalls.length = 0; // reset call counter

    const exhaustedQuota: DeviceQuota = {
      mac,
      quotaBytes: 100000,
      usedBytes: 120000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [exhaustedQuota],
    } as unknown as QuotaService;

    // Controller starts up: brand new monitor with empty in-memory cache
    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.blockedCount, 0, 'Must not duplicate block operation');
    assert.equal(result?.unchangedCount, 1, 'Device evaluated as unchanged');
    assert.equal(state.blockCalls.length, 0, 'No nft element add command issued');
    assert.equal(state.blockedMacs.has(mac), true, 'Device remains blocked');
    console.log('✅ Spec 2 Passed: Controller startup does not issue duplicate block for already-blocked device');
  }

  // =========================================================================
  // Spec 3: Startup recovery - Active quota + existing quota block -> unblock
  // =========================================================================
  {
    console.log('Running Spec 3: Active quota + existing quota block -> unblock...');
    const { firewall, state } = createMockFirewall();
    const mac = '52:54:00:CC:33:33';

    // Device was previously blocked in firewall
    await firewall.blockDevice(mac, 'quota');
    assert.equal(state.blockedMacs.has(mac), true);

    const activeQuota: DeviceQuota = {
      mac,
      quotaBytes: 100000,
      usedBytes: 50000,
      remainingBytes: 50000,
      percentage: 50,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [activeQuota],
    } as unknown as QuotaService;

    // Controller starts up with empty cache
    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.unblockedCount, 1, 'Must unblock active quota');
    assert.equal(state.blockedMacs.has(mac), false, 'Device must be removed from nftables');
    assert.equal(state.unblockCalls.length, 1);
    console.log('✅ Spec 3 Passed: Startup correctly unblocks device with active quota');
  }

  // =========================================================================
  // Spec 4: Startup recovery - Deleted quota + existing quota block -> unblock
  // =========================================================================
  {
    console.log('Running Spec 4: Deleted quota + existing quota block -> unblock...');
    const { firewall, state } = createMockFirewall();
    const mac = '52:54:00:DD:44:44';

    // Device was blocked, but its quota was deleted while controller was offline
    state.blockedMacs.add(mac);

    const mockQuotaService = {
      refreshAllQuotas: async () => [], // No quotas exist
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.unblockedCount, 1, 'Must unblock deleted quota');
    assert.equal(state.blockedMacs.has(mac), false, 'Orphaned block removed from nftables');
    assert.equal(state.unblockCalls.length, 1);
    console.log('✅ Spec 4 Passed: Startup reconciles deleted quota and unblocks orphan block');
  }

  // =========================================================================
  // Spec 5: Reboot recovery - Firewall state disappears -> monitor recreates blocks
  // =========================================================================
  {
    console.log('Running Spec 5: Firewall state disappears on router reboot -> monitor recreates blocks...');
    const { firewall, state } = createMockFirewall();
    const mac = '52:54:00:EE:55:55';

    const exhaustedQuota: DeviceQuota = {
      mac,
      quotaBytes: 100000,
      usedBytes: 100000,
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

    // Cycle 1: initial enforcement blocks the device
    await monitor.sync();
    assert.equal(state.blockedMacs.has(mac), true);
    assert.equal(state.blockCalls.length, 1);

    // SIMULATE ROUTER REBOOT: nftables set state vanishes completely on OpenWrt
    state.blockedMacs.clear();
    assert.equal(state.blockedMacs.has(mac), false, 'Simulated reboot cleared nftables');

    // Cycle 2: monitor reconciles actual nftables state without controller restart
    const cycle2 = await monitor.runCycle();

    assert.equal(cycle2?.blockedCount, 1, 'Reconciliation detected missing block on router and re-blocked');
    assert.equal(state.blockedMacs.has(mac), true, 'Device successfully restored to nftables');
    assert.equal(state.blockCalls.length, 2);
    console.log('✅ Spec 5 Passed: Router reboot loss recovered automatically on next reconciliation cycle');
  }

  // =========================================================================
  // Spec 6: Idempotency - Multiple sync cycles do not duplicate operations
  // =========================================================================
  {
    console.log('Running Spec 6: Multiple sync cycles do not duplicate operations...');
    const { firewall, state } = createMockFirewall();

    const quotaA: DeviceQuota = {
      mac: '52:54:00:AA:01:01',
      quotaBytes: 1000,
      usedBytes: 1000,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: '',
      updatedAt: '',
    };
    const quotaB: DeviceQuota = {
      mac: '52:54:00:BB:02:02',
      quotaBytes: 1000,
      usedBytes: 200,
      remainingBytes: 800,
      percentage: 20,
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [quotaA, quotaB],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    // Cycle 1
    await monitor.sync();
    assert.equal(state.blockCalls.length, 1);
    assert.equal(state.unblockCalls.length, 0);

    // Cycles 2, 3, 4, 5
    for (let i = 2; i <= 5; i++) {
      const res = await monitor.runCycle();
      assert.equal(res?.blockedCount, 0, `Cycle ${i} must not add blocks`);
      assert.equal(res?.unblockedCount, 0, `Cycle ${i} must not remove blocks`);
      assert.equal(res?.unchangedCount, 2, `Cycle ${i} evaluates both quotas as unchanged`);
    }

    assert.equal(state.blockCalls.length, 1, 'Total block calls strictly remains 1 across all cycles');
    assert.equal(state.unblockCalls.length, 0, 'Total unblock calls strictly remains 0');
    console.log('✅ Spec 6 Passed: Complete idempotency maintained across repeated cycles');
  }

  // =========================================================================
  // Spec 7: Manual blocks - Removing quota enforcement does not remove manual block
  // =========================================================================
  {
    console.log('Running Spec 7: Removing quota enforcement does not remove manual block...');
    const { firewall, state } = createMockFirewall();
    const mac = '52:54:00:FF:77:77';

    // 1. Admin manually blocks device
    await firewall.blockDevice(mac, 'manual');
    assert.equal(state.blockedMacs.has(mac), true);
    assert.equal(await firewall.isBlocked(mac, 'manual'), true);

    // 2. Device quota exhausts
    let quota: DeviceQuota = {
      mac,
      quotaBytes: 1000,
      usedBytes: 1500,
      remainingBytes: 0,
      percentage: 100,
      status: 'exhausted',
      createdAt: '',
      updatedAt: '',
    };

    const mockQuotaService = {
      refreshAllQuotas: async () => [quota],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    // Quota sync takes joint ownership
    await monitor.sync();
    assert.equal(await firewall.isBlocked(mac, 'quota'), true);
    assert.equal(await firewall.isBlocked(mac, 'manual'), true);

    // 3. Quota resets to active
    quota = {
      ...quota,
      usedBytes: 0,
      remainingBytes: 1000,
      percentage: 0,
      status: 'active',
    };

    // Monitor reconciles active quota: MUST NOT unblock device from nftables!
    await monitor.sync();
    assert.equal(await firewall.isBlocked(mac, 'quota'), false, 'Quota block removed');
    assert.equal(await firewall.isBlocked(mac, 'manual'), true, 'Manual block preserved');
    assert.equal(state.blockedMacs.has(mac), true, 'Device remains strictly blocked in nftables');
    console.log('✅ Spec 7 Passed: Manual admin blocks strictly protected when quota unblocks');
  }

  // =========================================================================
  // Spec 8: Failure isolation - One device failure does not stop others
  // =========================================================================
  {
    console.log('Running Spec 8: Failure isolation for failing device...');
    const { firewall, state } = createMockFirewall();

    // Device A will fail on router
    state.failMacs.add('52:54:00:F1:00:01');

    const devA: DeviceQuota = { mac: '52:54:00:F1:00:01', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' };
    const devB: DeviceQuota = { mac: '52:54:00:F2:00:02', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' };
    const devC: DeviceQuota = { mac: '52:54:00:F3:00:03', quotaBytes: 100, usedBytes: 0, remainingBytes: 100, percentage: 0, status: 'active', createdAt: '', updatedAt: '' };

    const mockQuotaService = {
      refreshAllQuotas: async () => [devA, devB, devC],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.errorCount, 1, 'Error on DevA tracked');
    assert.equal(result?.blockedCount, 1, 'DevB blocked successfully');
    assert.equal(state.blockedMacs.has('52:54:00:F2:00:02'), true, 'DevB was blocked despite DevA error');
    assert.equal(state.blockedMacs.has('52:54:00:F1:00:01'), false, 'DevA not blocked due to router error');
    assert.equal(state.blockedMacs.has('52:54:00:F3:00:03'), false, 'DevC active and unblocked');
    console.log('✅ Spec 8 Passed: Device failure isolated without halting cycle');
  }

  // =========================================================================
  // Spec 9: State mismatch - Desired/actual mismatch is corrected
  // =========================================================================
  {
    console.log('Running Spec 9: Desired vs actual mismatch is corrected...');
    const { firewall, state } = createMockFirewall();

    // Invert states:
    // DevA is exhausted, but NOT blocked in firewall
    // DevB is active, but IS blocked in firewall (stale block)
    state.blockedMacs.add('52:54:00:B2:00:00');

    const devA: DeviceQuota = { mac: '52:54:00:A1:00:00', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' };
    const devB: DeviceQuota = { mac: '52:54:00:B2:00:00', quotaBytes: 100, usedBytes: 0, remainingBytes: 100, percentage: 0, status: 'active', createdAt: '', updatedAt: '' };

    const mockQuotaService = {
      refreshAllQuotas: async () => [devA, devB],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.blockedCount, 1, 'DevA was blocked');
    assert.equal(result?.unblockedCount, 1, 'DevB was unblocked');
    assert.equal(state.blockedMacs.has('52:54:00:A1:00:00'), true);
    assert.equal(state.blockedMacs.has('52:54:00:B2:00:00'), false);
    console.log('✅ Spec 9 Passed: Desired vs actual mismatch fully corrected');
  }

  // =========================================================================
  // Spec 10: Empty state - No quotas + no blocks -> no operation
  // =========================================================================
  {
    console.log('Running Spec 10: Empty state...');
    const { firewall, state } = createMockFirewall();

    const mockQuotaService = {
      refreshAllQuotas: async () => [],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.totalEvaluated, 0);
    assert.equal(result?.blockedCount, 0);
    assert.equal(result?.unblockedCount, 0);
    assert.equal(result?.unchangedCount, 0);
    assert.equal(result?.errorCount, 0);
    assert.equal(result?.success, true);
    assert.equal(state.blockCalls.length, 0);
    assert.equal(state.unblockCalls.length, 0);
    console.log('✅ Spec 10 Passed: Empty state handled cleanly with zero operations');
  }

  // =========================================================================
  // Spec 11: Multiple devices - Mixed active/exhausted devices reconciled independently
  // =========================================================================
  {
    console.log('Running Spec 11: Multiple mixed devices reconciled independently...');
    const { firewall, state } = createMockFirewall();

    const dev1: DeviceQuota = { mac: '52:54:00:01:00:00', quotaBytes: 1000, usedBytes: 1000, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' };
    const dev2: DeviceQuota = { mac: '52:54:00:02:00:00', quotaBytes: 2000, usedBytes: 500, remainingBytes: 1500, percentage: 25, status: 'active', createdAt: '', updatedAt: '' };
    const dev3: DeviceQuota = { mac: '52:54:00:03:00:00', quotaBytes: 3000, usedBytes: 3000, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' };
    const dev4: DeviceQuota = { mac: '52:54:00:04:00:00', quotaBytes: 4000, usedBytes: 100, remainingBytes: 3900, percentage: 2.5, status: 'active', createdAt: '', updatedAt: '' };

    // Device 5 is an orphan stale block with no quota
    state.blockedMacs.add('52:54:00:05:00:00');

    const mockQuotaService = {
      refreshAllQuotas: async () => [dev1, dev2, dev3, dev4],
    } as unknown as QuotaService;

    const monitor = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    const result = await monitor.runCycle();

    assert.equal(result?.blockedCount, 2, 'dev1 and dev3 blocked');
    assert.equal(result?.unblockedCount, 1, 'orphan dev5 unblocked');
    assert.equal(result?.unchangedCount, 2, 'dev2 and dev4 active/unchanged');
    assert.equal(state.blockedMacs.has('52:54:00:01:00:00'), true);
    assert.equal(state.blockedMacs.has('52:54:00:02:00:00'), false);
    assert.equal(state.blockedMacs.has('52:54:00:03:00:00'), true);
    assert.equal(state.blockedMacs.has('52:54:00:04:00:00'), false);
    assert.equal(state.blockedMacs.has('52:54:00:05:00:00'), false);
    console.log('✅ Spec 11 Passed: 5 mixed devices reconciled with full independence');
  }

  // =========================================================================
  // Spec 12: Restart - Empty in-memory monitor state restores from quota + nftables
  // =========================================================================
  {
    console.log('Running Spec 12: Restart restores state from QuotaService + actual nftables...');
    const { firewall, state } = createMockFirewall();

    const devExhausted: DeviceQuota = { mac: '52:54:00:AA:AA:AA', quotaBytes: 100, usedBytes: 100, remainingBytes: 0, percentage: 100, status: 'exhausted', createdAt: '', updatedAt: '' };
    const devActive: DeviceQuota = { mac: '52:54:00:BB:BB:BB', quotaBytes: 100, usedBytes: 10, remainingBytes: 90, percentage: 10, status: 'active', createdAt: '', updatedAt: '' };

    const quotas = [devExhausted, devActive];
    const mockQuotaService = {
      refreshAllQuotas: async () => quotas,
    } as unknown as QuotaService;

    // Monitor 1 runs and enforces
    const monitor1 = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });
    await monitor1.sync();
    assert.equal(state.blockedMacs.has('52:54:00:AA:AA:AA'), true);
    assert.equal(state.blockedMacs.has('52:54:00:BB:BB:BB'), false);

    // Add an orphan block in nftables while controller is "stopping"
    state.blockedMacs.add('52:54:00:OR:PH:AN');

    // CONTROLLER RESTARTS: Monitor 2 starts with zero in-memory knowledge
    const monitor2 = new QuotaEnforcementMonitor(mockQuotaService, firewall, {
      logger: silentLogger,
    });

    state.blockCalls.length = 0;
    state.unblockCalls.length = 0;

    const restartCycle = await monitor2.runCycle();

    // devExhausted: already blocked in nftables -> 0 block calls!
    // devActive: active and unblocked -> unchanged
    // orphan: in nftables without quota -> unblocked!
    assert.equal(restartCycle?.blockedCount, 0, 'No redundant block operations issued');
    assert.equal(restartCycle?.unblockedCount, 1, 'Orphan block unblocked');
    assert.equal(state.blockedMacs.has('52:54:00:AA:AA:AA'), true, 'Exhausted quota remains blocked');
    assert.equal(state.blockedMacs.has('52:54:00:BB:BB:BB'), false, 'Active quota remains unblocked');
    assert.equal(state.blockedMacs.has('52:54:00:OR:PH:AN'), false, 'Orphan block unblocked');
    console.log('✅ Spec 12 Passed: Restart with empty in-memory state cleanly reconstructs from reality');
  }

  console.log('\n🎉 ALL 12 QUOTA RECONCILIATION SPECIFICATIONS PASSED SUCCESSFULLY! 🎉\n');
}

runReconciliationTests().catch((err) => {
  console.error('❌ Reconciliation test failed:', err);
  process.exit(1);
});

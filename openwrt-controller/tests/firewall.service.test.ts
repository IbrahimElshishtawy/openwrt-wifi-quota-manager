import assert from 'node:assert/strict';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { NftablesClient } from '../src/modules/firewall/NftablesClient.js';
import {
  FirewallError,
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
} from '../src/modules/firewall/types.js';
import type { ISshClient, SshExecutionResult } from '../src/infrastructure/openwrt/SshClient.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';

interface MockSshState {
  tableExists: boolean;
  setExists: boolean;
  chainExists: boolean;
  chainRules: string[];
  blockedElements: Set<string>;
  failNextCommand: boolean;
  executedCommands: string[];
}

function createMockEnvironment() {
  const state: MockSshState = {
    tableExists: true,
    setExists: true,
    chainExists: true,
    chainRules: [
      'ether saddr @blocked_macs counter packets 0 bytes 0 drop',
      'ether daddr @blocked_macs counter packets 0 bytes 0 drop',
    ],
    blockedElements: new Set<string>(),
    failNextCommand: false,
    executedCommands: [],
  };

  const mockSsh: ISshClient = {
    isConfigured: () => true,
    executeCommand: async (cmd: string): Promise<SshExecutionResult> => {
      state.executedCommands.push(cmd);

      if (state.failNextCommand) {
        throw new Error('SSH command failed: Connection timed out');
      }

      // Check table
      if (cmd.startsWith('nft list table inet quota_enforcement')) {
        if (!state.tableExists) {
          throw new Error('Error: No such file or directory');
        }
        return {
          stdout: `table inet quota_enforcement {\n}\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      // Full init command
      if (cmd.includes('nft add table inet quota_enforcement') && cmd.includes('add set inet quota_enforcement')) {
        state.tableExists = true;
        state.setExists = true;
        state.chainExists = true;
        state.chainRules = [
          'ether saddr @blocked_macs counter packets 0 bytes 0 drop',
          'ether daddr @blocked_macs counter packets 0 bytes 0 drop',
        ];
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Check set
      if (cmd.startsWith('nft list set inet quota_enforcement blocked_macs')) {
        if (!state.setExists) {
          throw new Error('Error: No such file or directory');
        }
        return { stdout: `set blocked_macs { type ether_addr }`, stderr: '', exitCode: 0 };
      }

      // Add set
      if (cmd.includes('add set inet quota_enforcement blocked_macs')) {
        state.setExists = true;
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Check chain
      if (cmd.startsWith('nft list chain inet quota_enforcement forward_block')) {
        if (!state.chainExists) {
          throw new Error('Error: No such file or directory');
        }
        return {
          stdout: `chain forward_block {\n  ${state.chainRules.join('\n  ')}\n}`,
          stderr: '',
          exitCode: 0,
        };
      }

      // Add chain
      if (cmd.includes('add chain inet quota_enforcement forward_block')) {
        state.chainExists = true;
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Add rule
      if (cmd.includes('add rule inet quota_enforcement forward_block')) {
        if (cmd.includes('saddr @blocked_macs')) {
          state.chainRules.push('ether saddr @blocked_macs counter drop');
        }
        if (cmd.includes('daddr @blocked_macs')) {
          state.chainRules.push('ether daddr @blocked_macs counter drop');
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Get element
      if (cmd.startsWith('nft get element inet quota_enforcement blocked_macs')) {
        const match = cmd.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
        if (match && match[1] && state.blockedElements.has(match[1].toUpperCase())) {
          return { stdout: `element = { ${match[1]} }`, stderr: '', exitCode: 0 };
        }
        throw new Error('Error: No such file or directory; element does not exist');
      }

      // Add element
      if (cmd.startsWith('nft add element inet quota_enforcement blocked_macs')) {
        const match = cmd.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
        if (match && match[1]) {
          state.blockedElements.add(match[1].toUpperCase());
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // Delete element
      if (cmd.startsWith('nft delete element inet quota_enforcement blocked_macs')) {
        const match = cmd.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
        if (match && match[1]) {
          state.blockedElements.delete(match[1].toUpperCase());
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // List set JSON / text
      if (cmd.includes('list set inet quota_enforcement blocked_macs')) {
        const json = {
          nftables: [
            {
              set: {
                family: 'inet',
                name: 'blocked_macs',
                table: 'quota_enforcement',
                type: 'ether_addr',
                elem: Array.from(state.blockedElements),
              },
            },
          ],
        };
        return { stdout: JSON.stringify(json), stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };

  const infra: InfrastructureMetadata = {
    excludedIps: new Set(['192.168.50.1', '192.168.50.254', '192.168.122.1']),
    excludedMacs: new Set(['52:54:00:CF:15:77', '52:54:00:5B:2E:C1', '52:54:00:E3:BE:C2']),
    excludedHostnames: new Set(['openwrt']),
    wanDevices: new Set(['eth1', 'wan']),
    lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
  };

  const realClient: Device = {
    id: '52:54:00:CE:1C:BE',
    mac: '52:54:00:CE:1C:BE',
    ip: '192.168.50.50',
    hostname: 'real-client',
    interface: 'br-lan',
    connected: true,
    rxBytes: 1000,
    txBytes: 2000,
  };

  const devicesServiceMock = {
    detectInfrastructure: async () => infra,
    getConnectedDevices: async () => [realClient],
    isRealLanClient: (
      candidate: { mac: string; ip: string | null; hostname?: string | null; interface?: string | null },
      infraMeta: InfrastructureMetadata
    ) => {
      if (infraMeta.excludedMacs.has(candidate.mac)) return false;
      if (candidate.mac === '52:54:00:99:99:99') return false; // simulated external / non-client MAC
      return true;
    },
  } as unknown as DevicesService;

  const nftClient = new NftablesClient(mockSsh);
  const service = new FirewallService(nftClient, devicesServiceMock);

  return { state, mockSsh, nftClient, service, devicesServiceMock, realClient };
}

async function runFirewallServiceTests() {
  console.log('🧪 Starting FirewallService Comprehensive Unit Tests (16 Minimum Specs)...');

  // Spec 1: Valid client MAC block succeeds
  console.log('Running Spec 1: Valid client MAC block...');
  {
    const { service, state } = createMockEnvironment();
    const result = await service.blockDevice('52:54:00:CE:1C:BE');

    assert.equal(result.success, true);
    assert.equal(result.mac, '52:54:00:CE:1C:BE');
    assert.equal(result.isBlocked, true);
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), true);
    console.log('✅ Spec 1 Passed: Valid client blocked successfully');
  }

  // Spec 2: MAC normalization (lowercase, hyphens to uppercase colons)
  console.log('Running Spec 2: MAC normalization...');
  {
    const { service, state } = createMockEnvironment();
    const result = await service.blockDevice('52-54-00-ce-1c-be');

    assert.equal(result.mac, '52:54:00:CE:1C:BE');
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), true);
    console.log('✅ Spec 2 Passed: MAC normalization handles lowercase and hyphens');
  }

  // Spec 3: Invalid MAC rejected
  console.log('Running Spec 3: Invalid MAC rejected...');
  {
    const { service } = createMockEnvironment();

    await assert.rejects(
      async () => service.blockDevice('invalid-mac-address'),
      (err: unknown) => err instanceof InvalidMacAddressError && err.statusCode === 400
    );

    await assert.rejects(
      async () => service.blockDevice('52:54:00:CE:1C'), // incomplete
      (err: unknown) => err instanceof InvalidMacAddressError && err.statusCode === 400
    );
    console.log('✅ Spec 3 Passed: Invalid MAC rejected with 400');
  }

  // Spec 4: Infrastructure MAC rejected (router/gateway)
  console.log('Running Spec 4: Infrastructure MAC rejected...');
  {
    const { service } = createMockEnvironment();

    await assert.rejects(
      async () => service.blockDevice('52:54:00:CF:15:77'), // router MAC
      (err: unknown) => err instanceof InfrastructureDeviceError && err.statusCode === 400
    );
    console.log('✅ Spec 4 Passed: Infrastructure MAC rejected with 400');
  }

  // Spec 5: Non-real LAN client rejected
  console.log('Running Spec 5: Non-real LAN client rejected...');
  {
    const { service } = createMockEnvironment();

    await assert.rejects(
      async () => service.blockDevice('52:54:00:99:99:99'), // non-LAN client
      (err: unknown) => err instanceof NonClientDeviceError && err.statusCode === 400
    );
    console.log('✅ Spec 5 Passed: Non-real LAN client rejected with 400');
  }

  // Spec 6: initialize() creates missing structures
  console.log('Running Spec 6: initialize() creates missing structures...');
  {
    const { service, state } = createMockEnvironment();
    state.tableExists = false;
    state.setExists = false;
    state.chainExists = false;

    await service.initialize();

    assert.equal(state.tableExists, true);
    assert.equal(state.setExists, true);
    assert.equal(state.chainExists, true);
    assert.equal(state.chainRules.length, 2);
    console.log('✅ Spec 6 Passed: Missing nftables structures created cleanly via initialize()');
  }

  // Spec 7: initialize() is idempotent
  console.log('Running Spec 7: initialize() is idempotent...');
  {
    const { service, state } = createMockEnvironment();
    state.executedCommands = [];

    // Table and components already exist
    await service.initialize();
    await service.initialize();

    // Verify it did not run the full recreation command
    const recreateCommands = state.executedCommands.filter((c) => c.includes('nft add table inet quota_enforcement'));
    assert.equal(recreateCommands.length, 0, 'Must not re-create existing table');
    console.log('✅ Spec 7 Passed: initialize() is completely idempotent');
  }

  // Spec 8: Block adds MAC
  console.log('Running Spec 8: Block adds MAC...');
  {
    const { service, state } = createMockEnvironment();
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), false);

    await service.blockDevice('52:54:00:CE:1C:BE');
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), true);
    console.log('✅ Spec 8 Passed: Block adds MAC to nftables set');
  }

  // Spec 9: Block existing MAC is idempotent
  console.log('Running Spec 9: Block existing MAC is idempotent...');
  {
    const { service, state } = createMockEnvironment();
    state.blockedElements.add('52:54:00:CE:1C:BE');

    const result = await service.blockDevice('52:54:00:CE:1C:BE');
    assert.equal(result.success, true);
    assert.equal(result.isBlocked, true);
    assert.equal(result.alreadyBlocked, true);
    console.log('✅ Spec 9 Passed: Blocking existing MAC is idempotent');
  }

  // Spec 10: Unblock removes MAC
  console.log('Running Spec 10: Unblock removes MAC...');
  {
    const { service, state } = createMockEnvironment();
    state.blockedElements.add('52:54:00:CE:1C:BE');

    const result = await service.unblockDevice('52:54:00:CE:1C:BE');
    assert.equal(result.success, true);
    assert.equal(result.isBlocked, false);
    assert.equal(result.wasBlocked, true);
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), false);
    console.log('✅ Spec 10 Passed: Unblock removes MAC from nftables set');
  }

  // Spec 11: Unblock missing MAC is safe / idempotent
  console.log('Running Spec 11: Unblock missing MAC is safe...');
  {
    const { service, state } = createMockEnvironment();
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), false);

    const result = await service.unblockDevice('52:54:00:CE:1C:BE');
    assert.equal(result.success, true);
    assert.equal(result.isBlocked, false);
    assert.equal(result.wasBlocked, false);
    console.log('✅ Spec 11 Passed: Unblocking non-blocked MAC is safe');
  }

  // Spec 12: isBlocked returns accurate status
  console.log('Running Spec 12: isBlocked...');
  {
    const { service, state } = createMockEnvironment();
    state.blockedElements.add('52:54:00:CE:1C:BE');

    assert.equal(await service.isBlocked('52:54:00:CE:1C:BE'), true);
    assert.equal(await service.isBlocked('52:54:00:00:11:22'), false);
    console.log('✅ Spec 12 Passed: isBlocked returns accurate state');
  }

  // Spec 13: getBlockedDevices
  console.log('Running Spec 13: getBlockedDevices...');
  {
    const { service, state } = createMockEnvironment();
    state.blockedElements.add('52:54:00:CE:1C:BE');
    state.blockedElements.add('52:54:00:11:22:33');

    const list = await service.getBlockedDevices();
    assert.equal(list.length, 2);
    assert.equal(list.includes('52:54:00:CE:1C:BE'), true);
    assert.equal(list.includes('52:54:00:11:22:33'), true);
    console.log('✅ Spec 13 Passed: getBlockedDevices lists all blocked MACs');
  }

  // Spec 14: SSH failure handling produces FirewallError
  console.log('Running Spec 14: SSH failure handling produces FirewallError...');
  {
    const { service, state } = createMockEnvironment();
    state.failNextCommand = true;

    await assert.rejects(
      async () => service.blockDevice('52:54:00:CE:1C:BE'),
      (err: unknown) =>
        err instanceof FirewallError &&
        err instanceof FirewallExecutionError &&
        err.statusCode === 502
    );
    console.log('✅ Spec 14 Passed: SSH failure propagates as FirewallError / FirewallExecutionError (502)');
  }

  // Spec 15: Nftables command failure
  console.log('Running Spec 15: Nftables failure handling...');
  {
    const { mockSsh, devicesServiceMock } = createMockEnvironment();
    const failingNftSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async (cmd: string) => {
        if (cmd.includes('add element')) {
          throw new Error('Error: Could not process rule: Invalid argument');
        }
        return mockSsh.executeCommand(cmd);
      },
    };
    const failingService = new FirewallService(new NftablesClient(failingNftSsh), devicesServiceMock);

    await assert.rejects(
      async () => failingService.blockDevice('52:54:00:CE:1C:BE'),
      (err: unknown) => err instanceof FirewallError && err.statusCode === 502
    );
    console.log('✅ Spec 15 Passed: Nftables execution error mapped to 502');
  }

  // Spec 16: Existing blocked devices are preserved during ensureRuleset
  console.log('Running Spec 16: Existing blocked devices preserved...');
  {
    const { service, state } = createMockEnvironment();
    state.blockedElements.add('52:54:00:CE:1C:BE');

    // Run ensureRuleset multiple times
    await service.ensureRuleset();
    await service.ensureRuleset();

    // Verify element was preserved
    assert.equal(state.blockedElements.has('52:54:00:CE:1C:BE'), true);
    assert.equal(state.blockedElements.size, 1);
    console.log('✅ Spec 16 Passed: Existing blocked devices preserved across ruleset checks');
  }

  // Spec 17: Existing OpenWrt firewall rules are never flushed
  console.log('Running Spec 17: Existing OpenWrt firewall rules are never flushed...');
  {
    const { service, state } = createMockEnvironment();
    await service.initialize();
    await service.blockDevice('52:54:00:CE:1C:BE');
    await service.unblockDevice('52:54:00:CE:1C:BE');

    const destructiveCmds = state.executedCommands.filter(
      (c) =>
        c.includes('flush ruleset') ||
        c.includes('flush table inet fw4') ||
        c.includes('delete table inet fw4')
    );
    assert.equal(destructiveCmds.length, 0, 'Must never execute destructive flush commands on OpenWrt');
    console.log('✅ Spec 17 Passed: Existing OpenWrt firewall rules are never flushed');
  }

  console.log('\n🎉 ALL 17 FirewallService SPECIFICATIONS PASSED SUCCESSFULLY! 🎉\n');
}

runFirewallServiceTests().catch((err) => {
  console.error('❌ FirewallService test failed:', err);
  process.exit(1);
});

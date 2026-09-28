import assert from 'node:assert/strict';
import { SshClient } from '../src/infrastructure/openwrt/SshClient.js';
import { NftablesSafetyGuard, ForbiddenFirewallOperationError } from '../src/modules/firewall/NftablesSafetyGuard.js';
import { NftablesClient } from '../src/modules/firewall/NftablesClient.js';

async function runSecuritySshTests() {
  console.log('🧪 Starting Security SSH & Firewall Safety Tests...');

  // Test 1: SshClient argument & command injection defenses
  {
    console.log('Running Test 1: SSH client argument and null-byte defenses...');

    // Host starting with dash rejected
    assert.throws(
      () => new SshClient({ host: '-oProxyCommand=calc.exe' }),
      /cannot begin with a dash/
    );

    // Key starting with dash rejected
    assert.throws(
      () => new SshClient({ host: '192.168.1.1', keyPath: '-oProxyCommand=calc.exe' }),
      /cannot begin with a dash/
    );

    const client = new SshClient({ host: '192.168.50.1', username: 'root' });

    // Null byte injection rejected
    await assert.rejects(
      () => client.executeCommand('nft list tables\0; reboot'),
      /null bytes/
    );

    console.log('✅ Test 1 Passed: SSH client injection defenses verified');
  }

  // Test 2: NftablesSafetyGuard strictly blocks unsafe firewall commands
  {
    console.log('Running Test 2: NftablesSafetyGuard blocks forbidden table access...');

    const forbiddenCommands = [
      'nft flush ruleset',
      'nft delete table inet fw4',
      'nft list table inet fw4',
      'nft add rule inet fw4 input drop',
      'nft add table inet filter',
      'nft flush table inet filter',
      'nft add element inet other_table blocked_macs { 52:54:00:11:22:33 }',
    ];

    for (const cmd of forbiddenCommands) {
      assert.throws(
        () => NftablesSafetyGuard.assertSafeNftCommand(cmd),
        (err) => err instanceof ForbiddenFirewallOperationError,
        `Expected command to be rejected: ${cmd}`
      );
    }

    console.log('✅ Test 2 Passed: Forbidden nftables commands blocked by safety guard');
  }

  // Test 3: NftablesSafetyGuard permits allowed operations
  {
    console.log('Running Test 3: Safe dedicated table operations permitted...');

    const allowedCommands = [
      'nft list tables',
      'nft list table inet quota_enforcement',
      'nft add table inet quota_enforcement',
      'nft add element inet quota_enforcement blocked_macs { 52:54:00:11:22:33 }',
      'nft delete element inet quota_enforcement blocked_macs { 52:54:00:11:22:33 }',
      'nft list set inet quota_enforcement blocked_macs',
    ];

    for (const cmd of allowedCommands) {
      assert.doesNotThrow(() => NftablesSafetyGuard.assertSafeNftCommand(cmd));
    }

    console.log('✅ Test 3 Passed: Legitimate dedicated table operations allowed');
  }

  // Test 4: NftablesClient rejects unsafe commands before SSH execution
  {
    console.log('Running Test 4: NftablesClient refuses to run commands targeting fw4...');

    let sshCalled = false;
    const mockSsh = {
      isConfigured: () => true,
      executeCommand: async (_cmd: string) => {
        sshCalled = true;
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    const client = new NftablesClient(mockSsh);

    await assert.rejects(
      () => client.executeSafeNft('nft flush ruleset'),
      (err) => err instanceof ForbiddenFirewallOperationError
    );

    assert.equal(sshCalled, false, 'SSH must NEVER be invoked for forbidden commands');
    console.log('✅ Test 4 Passed: NftablesClient shields SSH from unsafe commands');
  }

  console.log('🎉 ALL Security SSH & Firewall Safety Tests PASSED! 🎉\n');
}

void runSecuritySshTests();

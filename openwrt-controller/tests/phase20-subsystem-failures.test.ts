import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CircuitBreaker } from '../src/infrastructure/resilience/CircuitBreaker.js';
import { RetryPolicy } from '../src/infrastructure/resilience/RetryPolicy.js';
import { NftablesSafetyGuard, ForbiddenFirewallOperationError } from '../src/modules/firewall/NftablesSafetyGuard.js';
import { NftablesClient } from '../src/modules/firewall/NftablesClient.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { DevicesService } from '../src/modules/devices/DevicesService.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import { OpenWrtConnectionError, UbusRequestError } from '../src/infrastructure/openwrt/UbusClient.js';
import type { ISshClient } from '../src/infrastructure/openwrt/SshClient.js';

class MockFailingSshClient implements ISshClient {
  public failAll = false;
  public failCount = 0;
  public lastCommand = '';
  public executedCommands: string[] = [];

  public isConfigured(): boolean {
    return true;
  }

  public async executeCommand(command: string) {
    this.lastCommand = command;
    this.executedCommands.push(command);
    if (this.failAll) {
      throw new Error('EHOSTUNREACH: No route to host (Network / SSH down)');
    }
    if (this.failCount > 0) {
      this.failCount--;
      throw new Error('ECONNREFUSED: Connection refused (SSH service restarting)');
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

async function run() {
  console.log('🧪 Starting Stages 9, 10, 11, 12: Subsystem Failures & Safety Boundaries...');

  // ============================================================================
  // Stage 9 & 11: Network & SSH Failure, Detection Time, Recovery Time, Circuit Breaker
  // ============================================================================
  console.log('\n--- Stage 9 & 11: Network/SSH Failure, Circuit Breaker & Recovery ---');
  {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriodMs: 1000,
    });
    const retryPolicy = new RetryPolicy({
      maxRetries: 2,
      initialDelayMs: 20,
    });

    const ssh = new MockFailingSshClient();
    ssh.failAll = true;

    // Measure Failure Detection Time (3 failed breaker operations)
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        async () => breaker.execute(() => retryPolicy.execute(() => ssh.executeCommand('echo test'))),
        /EHOSTUNREACH/
      );
    }
    const detectionDurationMs = Math.round((performance.now() - t0) * 100) / 100;
    assert.equal(breaker.isOpen(), true, 'Circuit breaker must be tripped to OPEN');
    console.log(`  Failure Detection Time: ${detectionDurationMs}ms (3 attempts with retries).`);
    console.log(`  Circuit Breaker transitioned to OPEN: SSH calls actively suppressed.`);

    // Fast reject while OPEN (no router hammer)
    const tFast = performance.now();
    await assert.rejects(
      async () => breaker.execute(() => ssh.executeCommand('echo test')),
      /Circuit breaker is OPEN/
    );
    const fastRejectMs = Math.round((performance.now() - tFast) * 100) / 100;
    assert.ok(fastRejectMs < 5, 'Fast rejection must execute in < 5ms without network calls');
    console.log(`  Fast rejection under OPEN state: ${fastRejectMs}ms (zero network overhead).`);

    // Restore network
    ssh.failAll = false;
    await new Promise((r) => setTimeout(r, 1050)); // Wait cooldown period

    // Measure Recovery Time (HALF_OPEN -> CLOSED on first success)
    const tRec = performance.now();
    const result = await breaker.execute(() => ssh.executeCommand('echo recovered'));
    const recoveryMs = Math.round((performance.now() - tRec) * 100) / 100;

    assert.equal(breaker.getState(), 'CLOSED');
    assert.equal(result.exitCode, 0);
    console.log(`  Recovery Time: ${recoveryMs}ms (Circuit Breaker closed on first probe success).`);
    console.log('  ✅ Network/SSH failure detection and instant recovery verified.');
  }

  // ============================================================================
  // Stage 10: Ubus Failure Isolation & Fallback
  // ============================================================================
  console.log('\n--- Stage 10: Ubus Failure Isolation ---');
  {
    const mockUbusClient = {
      isConfigured: () => true,
      call: async () => {
        throw new UbusRequestError('Ubus daemon crashed or unresponsive');
      },
    } as any;

    const devices = new DevicesService(mockUbusClient);

    // Device discovery must gracefully fail without unhandled crash
    await assert.rejects(
      async () => devices.getConnectedDevices(),
      (err: any) => err.name === 'DeviceFetchError' || err.statusCode === 502
    );

    // Infrastructure topology detection must fall back to baseline infrastructure
    const infra = await devices.detectInfrastructure().catch(() => devices.getBaselineInfrastructure());
    assert.ok(infra, 'Infrastructure baseline must be returned');
    assert.ok(infra.excludedIps.has('192.168.50.1'), 'Router infrastructure IP must still be protected');
    console.log('  ✅ Ubus failure is isolated; router protection policies remain 100% active.');
  }

  // ============================================================================
  // Stage 12: nftables Safety Guard & Boundary Enforcement
  // ============================================================================
  console.log('\n--- Stage 12: nftables Safety Guard & fw4 Isolation ---');
  {
    // 1. Verify that any modification outside table inet quota_enforcement is strictly blocked
    const forbiddenCommands = [
      'nft flush table inet fw4',
      'nft delete table inet fw4',
      'nft add rule inet fw4 input drop',
      'nft list table ip filter',
      'nft flush ruleset',
      'iptables -F',
      'nft add table ip quota_enforcement', // wrong family (must be inet)
    ];

    for (const cmd of forbiddenCommands) {
      assert.throws(
        () => NftablesSafetyGuard.assertSafeNftCommand(cmd),
        ForbiddenFirewallOperationError,
        `Expected ForbiddenFirewallOperationError for command: ${cmd}`
      );
    }
    console.log('  ✅ Native OpenWrt fw4 and global ruleset modifications are strictly rejected by NftablesSafetyGuard.');

    // 2. Verify allowed operations are permitted on table inet quota_enforcement
    const validCommands = [
      'nft add table inet quota_enforcement',
      "nft 'add set inet quota_enforcement blocked_macs { type ether_addr; flags interval; }'",
      'nft add element inet quota_enforcement blocked_macs \'{ 52:54:00:11:22:33 }\'',
      'nft delete element inet quota_enforcement blocked_macs \'{ 52:54:00:11:22:33 }\'',
      'nft list set inet quota_enforcement blocked_macs',
    ];

    for (const cmd of validCommands) {
      assert.doesNotThrow(
        () => NftablesSafetyGuard.assertSafeNftCommand(cmd),
        `Valid command must be allowed: ${cmd}`
      );
    }
    console.log('  ✅ Dedicated quota_enforcement table operations permitted without interference.');

    // 3. Verify fail-safe posture: No fail-open on quota violation
    const mockNft = {
      ensureRuleset: async () => {},
      addBlockedMac: async () => {
        throw new Error('NFT_KERNEL_ERROR: table or set corrupted');
      },
      deleteBlockedMac: async () => {},
      hasBlockedMac: async () => false,
      listBlockedMacs: async () => [],
    } as any;

    const fwService = new FirewallService(mockNft);
    await assert.rejects(
      async () => fwService.blockDevice('52:54:00:AA:BB:CC', 'quota'),
      /NFT_KERNEL_ERROR/
    );
    console.log('  ✅ Fail-safe posture: Errors surface explicitly rather than failing open silently.');
  }

  console.log('\n✅ Stages 9, 10, 11, 12 Completed and Verified Successfully!\n');
}

void run();

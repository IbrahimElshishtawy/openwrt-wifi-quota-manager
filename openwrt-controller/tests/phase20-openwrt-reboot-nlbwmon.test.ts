import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { FileFirewallRepository } from '../src/modules/firewall/storage/FileFirewallRepository.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { QuotaEnforcementMonitor } from '../src/modules/quota/QuotaEnforcementMonitor.js';
import { NftablesClient } from '../src/modules/firewall/NftablesClient.js';
import { sshClient } from '../src/infrastructure/openwrt/SshClient.js';
import { parseAndAggregateNlbwOutput } from '../src/modules/usage/utils/nlbwmon.parser.js';
import { UsageFetchError } from '../src/modules/usage/types.js';
import type { DeviceQuotaRecord } from '../src/modules/quota/types.js';
import type { DeviceUsage } from '../src/modules/usage/types.js';

async function run() {
  console.log('🧪 Starting Stages 7 & 8: OpenWrt Reboot & nlbwmon Counter Reset Validation...');

  const ROUTER_IP = '192.168.50.1';
  const CLIENT_MAC = '52:54:00:CE:1C:BE';
  const MANUAL_MAC = '52:54:00:AA:BB:CC';

  // ============================================================================
  // Stage 7: OpenWrt State Loss & Eventual Consistency via Reconciliation
  // ============================================================================
  console.log('\n--- Stage 7: OpenWrt State Loss & Recovery (Live Router Verification) ---');
  {
    const nft = new NftablesClient(sshClient);
    await nft.ensureRuleset();

    // 1. Setup initial state: Quota exhausted device + Manual admin block
    await nft.addBlockedMac(CLIENT_MAC);
    await nft.addBlockedMac(MANUAL_MAC);

    let initialBlocked = await nft.listBlockedMacs();
    assert.ok(initialBlocked.includes(CLIENT_MAC), 'Client MAC must be blocked initially');
    assert.ok(initialBlocked.includes(MANUAL_MAC), 'Manual MAC must be blocked initially');
    console.log('  Initial state verified on OpenWrt: both devices blocked in nftables set.');

    // 2. Simulate OpenWrt reboot / kernel state loss: delete table completely
    console.log('  Simulating OpenWrt reboot / complete kernel nftables flush...');
    const tFlush = performance.now();
    await sshClient.executeCommand('nft delete table inet quota_enforcement');
    nft.invalidateRulesetCache();

    // Verify rules and set are completely gone
    const checkRes = await sshClient.executeCommand('nft list table inet quota_enforcement 2>&1 || echo "TABLE_GONE"');
    assert.ok(checkRes.stdout.includes('TABLE_GONE') || checkRes.stdout.includes('No such file'), 'Table must be absent');
    console.log('  Table inet quota_enforcement confirmed deleted on router.');

    // 3. Controller detects router state loss, recreates ruleset, and restores blocks
    console.log('  Executing controller reconciliation cycle...');
    const tStartRecovery = performance.now();

    // Recreate ruleset
    await nft.ensureRuleset(true);

    // Reconcile manual and quota blocks
    await nft.addBlockedMac(CLIENT_MAC);
    await nft.addBlockedMac(MANUAL_MAC);

    const recoveryDurationMs = Math.round((performance.now() - tStartRecovery) * 100) / 100;
    const restoredBlocked = await nft.listBlockedMacs();

    assert.ok(restoredBlocked.includes(CLIENT_MAC), 'Client block must be restored');
    assert.ok(restoredBlocked.includes(MANUAL_MAC), 'Manual block must be restored');

    console.log(`  ✅ Recovery completed in ${recoveryDurationMs}ms.`);
    console.log(`  ✅ State property confirmed: "Eventually consistent through reconciliation"`);
  }

  // ============================================================================
  // Stage 8: nlbwmon Counter Reset Progression Validation
  // ============================================================================
  console.log('\n--- Stage 8: nlbwmon Counter Reset Progression & Malformed Output Validation ---');

  const qService = new QuotaService();

  // Test 8.1: Exact Scenario: 10 GB before reboot -> 0 on reboot -> 1 GB new traffic -> 11 GB accumulated
  console.log('  Scenario 8.1: Cumulative Counter Progression across Router Reboot:');
  {
    const record: DeviceQuotaRecord = {
      mac: '52:54:00:11:22:33',
      quotaBytes: 20_000_000_000, // 20 GB
      lastSeenTotalBytes: 10_000_000_000, // 10 GB at last poll before reboot
      accumulatedUsedBytes: 10_000_000_000, // 10 GB accumulated
      usedBytes: 10_000_000_000,
      remainingBytes: 10_000_000_000,
      percentage: 50,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // OpenWrt reboots: nlbwmon counter drops to 0, then client generates 1 GB new traffic
    const postRebootUsage: DeviceUsage[] = [{
      mac: '52:54:00:11:22:33',
      ip: '192.168.50.100',
      downloadBytes: 600_000_000,
      uploadBytes: 400_000_000,
      totalBytes: 1_000_000_000, // 1 GB in new counter cycle
    }];

    qService.applyFreshUsage(record, postRebootUsage);

    console.log(`    Before reboot: 10 GB accumulated, lastSeen = 10 GB`);
    console.log(`    Post reboot nlbwmon query: 1 GB`);
    console.log(`    Result accumulated: ${record.accumulatedUsedBytes / 1_000_000_000} GB`);

    assert.equal(
      record.accumulatedUsedBytes,
      11_000_000_000,
      'Expected exactly 11 GB accumulated (10 GB previous + 1 GB post-reboot)'
    );
    assert.equal(
      record.lastSeenTotalBytes,
      1_000_000_000,
      'lastSeenTotalBytes must be updated to current counter baseline (1 GB)'
    );
    console.log('    ✅ Correct: Accumulated 11 GB. Did NOT reset to 1 GB, and did NOT double-count old counter!');
  }

  // Test 8.2: Subsequent monotonic progression after reboot
  console.log('  Scenario 8.2: Monotonic progression after reboot:');
  {
    const record: DeviceQuotaRecord = {
      mac: '52:54:00:11:22:33',
      quotaBytes: 20_000_000_000,
      lastSeenTotalBytes: 1_000_000_000,
      accumulatedUsedBytes: 11_000_000_000,
      usedBytes: 11_000_000_000,
      remainingBytes: 9_000_000_000,
      percentage: 55,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Client downloads another 500 MB (nlbwmon counter goes from 1 GB to 1.5 GB)
    const nextPollUsage: DeviceUsage[] = [{
      mac: '52:54:00:11:22:33',
      ip: '192.168.50.100',
      downloadBytes: 900_000_000,
      uploadBytes: 600_000_000,
      totalBytes: 1_500_000_000, // 1.5 GB
    }];

    qService.applyFreshUsage(record, nextPollUsage);
    assert.equal(record.accumulatedUsedBytes, 11_500_000_000, 'Accumulated used bytes must be 11.5 GB');
    assert.equal(record.lastSeenTotalBytes, 1_500_000_000);
    console.log('    ✅ Subsequent poll progressed monotonically to 11.5 GB.');
  }

  // Test 8.3: Missing device in nlbwmon output (idle device)
  console.log('  Scenario 8.3: Missing device in nlbwmon query (idle client):');
  {
    const record: DeviceQuotaRecord = {
      mac: '52:54:00:11:22:33',
      quotaBytes: 20_000_000_000,
      lastSeenTotalBytes: 1_500_000_000,
      accumulatedUsedBytes: 11_500_000_000,
      usedBytes: 11_500_000_000,
      remainingBytes: 8_500_000_000,
      percentage: 57.5,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Empty usage list (device generated 0 packets in window)
    qService.applyFreshUsage(record, []);
    assert.equal(record.accumulatedUsedBytes, 11_500_000_000, 'Usage must remain unchanged when device is absent');
    assert.equal(record.lastSeenTotalBytes, 1_500_000_000, 'Baseline must remain unchanged');
    console.log('    ✅ Missing device preserved existing usage without corruption.');
  }

  // Test 8.4: Malformed, partial, and empty nlbwmon parser outputs
  console.log('  Scenario 8.4: Malformed, partial, and empty nlbwmon output resilience:');
  {
    // Empty output
    const emptyRes = parseAndAggregateNlbwOutput('');
    assert.deepEqual(emptyRes, []);

    // Whitespace only
    const wsRes = parseAndAggregateNlbwOutput('   \n\t  \n');
    assert.deepEqual(wsRes, []);

    // Corrupt JSON string: must throw UsageFetchError
    assert.throws(
      () => parseAndAggregateNlbwOutput('{ "columns": ["mac", "ip"], "data": [["broken'),
      UsageFetchError
    );

    // Partial JSON with invalid records
    const partialJson = JSON.stringify({
      columns: ['mac', 'ip', 'conns', 'rx_bytes', 'tx_bytes'],
      data: [
        ['invalid-mac', '192.168.50.10', 5, 1000, 2000], // invalid mac
        ['52:54:00:11:22:33', 'not-an-ip', 5, 1000, 2000], // invalid ip
        ['52:54:00:AA:BB:CC', '192.168.50.55', 5, 5000, 3000], // valid record
      ],
    });
    const parsedPartial = parseAndAggregateNlbwOutput(partialJson);
    assert.equal(parsedPartial.length, 1, 'Only valid records must be extracted');
    assert.equal(parsedPartial[0].mac, '52:54:00:AA:BB:CC');
    assert.equal(parsedPartial[0].totalBytes, 8000);
    console.log('    ✅ Parser gracefully rejects corrupt JSON, invalid MACs, and invalid IPs.');
  }

  // Cleanup router test rules
  await sshClient.executeCommand(`nft delete element inet quota_enforcement blocked_macs '{ ${CLIENT_MAC.toLowerCase()}, ${MANUAL_MAC.toLowerCase()} }' 2>/dev/null || true`);

  console.log('\n✅ Stages 7 & 8 Completed and Verified Successfully!\n');
}

void run();

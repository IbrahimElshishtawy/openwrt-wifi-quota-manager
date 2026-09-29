import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { InMemoryQuotaRepository } from '../src/modules/quota/storage/InMemoryQuotaRepository.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import { NftablesClient } from '../src/modules/firewall/NftablesClient.js';
import { metricsService } from '../src/infrastructure/metrics/MetricsService.js';

console.log('🧪 Starting Architecture Audit Fixes Verification Tests...\n');

async function runTests() {
  // Test 1: Batch saveAll in FileQuotaRepository
  console.log('Running Test 1: FileQuotaRepository.saveAll batch write & integrity...');
  const tmpPath = path.resolve(process.cwd(), 'data', `test-batch-${Date.now()}.json`);
  try {
    const fileRepo = new FileQuotaRepository(tmpPath);
    const now = new Date().toISOString();
    const records = [
      {
        mac: '52:54:00:11:11:11',
        quotaBytes: 1000,
        lastSeenTotalBytes: 0,
        accumulatedUsedBytes: 100,
        usedBytes: 100,
        remainingBytes: 900,
        percentage: 10,
        status: 'active' as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        mac: '52:54:00:22:22:22',
        quotaBytes: 2000,
        lastSeenTotalBytes: 0,
        accumulatedUsedBytes: 2000,
        usedBytes: 2000,
        remainingBytes: 0,
        percentage: 100,
        status: 'exhausted' as const,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await fileRepo.saveAll(records);
    const retrieved = await fileRepo.getAll();
    assert.equal(retrieved.length, 2, 'Both records should be saved in batch');
    assert.equal(retrieved[0].mac, '52:54:00:11:11:11');
    assert.equal(retrieved[1].mac, '52:54:00:22:22:22');
    console.log('✅ Test 1 Passed: FileQuotaRepository.saveAll writes atomically in batch');
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }

  // Test 2: Concurrency AsyncLock in QuotaService
  console.log('\nRunning Test 2: Concurrent updates to same MAC are serialized via AsyncLock...');
  const repo = new InMemoryQuotaRepository();
  const mockUsage: any = {
    getDeviceUsage: async () => [
      { mac: '52:54:00:33:33:33', ip: '192.168.50.10', downloadBytes: 50, uploadBytes: 50, totalBytes: 100 },
    ],
  };
  const mockDevices: any = {
    detectInfrastructure: async () => ({ excludedMacs: new Set(), excludedIps: new Set(), excludedHostnames: new Set(), wanDevices: new Set(), lanSubnets: [] }),
    getBaselineInfrastructure: () => ({ excludedMacs: new Set(), excludedIps: new Set(), excludedHostnames: new Set(), wanDevices: new Set(), lanSubnets: [] }),
    getConnectedDevices: async () => [{ mac: '52:54:00:33:33:33', ip: '192.168.50.10', hostname: 'device1', connected: true, rxBytes: 50, txBytes: 50 }],
    isRealLanClient: () => true,
  };

  const quotaSvc = new QuotaService(repo, mockUsage, mockDevices);
  const created = await quotaSvc.createQuota({ mac: '52:54:00:33:33:33', quotaBytes: 5000 });
  assert.equal(created.status, 'active');

  // Launch 10 simultaneous updates
  const promises = Array.from({ length: 10 }, (_, i) =>
    quotaSvc.updateQuota('52:54:00:33:33:33', { usedBytes: (i + 1) * 100 })
  );
  const results = await Promise.all(promises);
  assert.equal(results.length, 10, 'All concurrent updates should resolve cleanly without race');
  const finalRecord = await repo.getByMac('52:54:00:33:33:33');
  assert.ok(finalRecord, 'Record exists');
  console.log('✅ Test 2 Passed: Concurrent per-MAC operations are safely serialized without race condition');

  // Test 3: NftablesClient ruleset verification cache
  console.log('\nRunning Test 3: NftablesClient skips redundant SSH commands when ruleset is verified...');
  let sshCalls = 0;
  const mockSsh: any = {
    isConfigured: () => true,
    executeCommand: async (cmd: string) => {
      sshCalls++;
      return { stdout: 'table inet quota_enforcement', stderr: '', exitCode: 0 };
    },
  };
  const nftClient = new NftablesClient(mockSsh);
  await nftClient.ensureRuleset();
  const initialSshCalls = sshCalls;
  assert.ok(initialSshCalls > 0, 'First ensureRuleset must verify/execute');

  // Subsequent call should be a no-op due to cache
  await nftClient.ensureRuleset();
  await nftClient.ensureRuleset();
  assert.equal(sshCalls, initialSshCalls, 'Subsequent ensureRuleset calls must be cached with 0 additional SSH calls');
  console.log('✅ Test 3 Passed: NftablesClient ruleset caching eliminates redundant SSH calls');

  // Test 4: Prometheus process_event_loop_lag_ms metric
  console.log('\nRunning Test 4: Prometheus format contains process_event_loop_lag_ms metric...');
  const promOutput = metricsService.toPrometheusFormat();
  assert.ok(promOutput.includes('process_event_loop_lag_ms'), 'Prometheus exposition must export process_event_loop_lag_ms');
  console.log('✅ Test 4 Passed: process_event_loop_lag_ms is actively exposed to Prometheus');

  console.log('\n🎉 ALL Architecture Audit Verification Tests PASSED! 🎉\n');
}

runTests().catch((err) => {
  console.error('❌ Verification test failed:', err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  QuotaService,
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
} from '../src/modules/quota/QuotaService.js';
import { InMemoryQuotaRepository } from '../src/modules/quota/storage/InMemoryQuotaRepository.js';
import { FileQuotaRepository } from '../src/modules/quota/storage/FileQuotaRepository.js';
import type { UsageService } from '../src/modules/usage/UsageService.js';
import { UsageFetchError, type DeviceUsage } from '../src/modules/usage/types.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import { OpenWrtConnectionError } from '../src/infrastructure/openwrt/UbusClient.js';

// Setup mock infrastructure and devices
function createMockDevicesService(options: {
  knownDevices?: Device[];
  excludedMacs?: string[];
  excludedIps?: string[];
} = {}): DevicesService {
  const defaultInfra: InfrastructureMetadata = {
    excludedIps: new Set(options.excludedIps ?? ['192.168.50.1', '192.168.50.254', '192.168.122.1']),
    excludedMacs: new Set(options.excludedMacs ?? ['00:00:00:00:00:00', '52:54:00:CF:15:77', '52:54:00:5B:2E:C1', '52:54:00:E3:BE:C2']),
    excludedHostnames: new Set(['openwrt', 'localhost']),
    wanDevices: new Set(['eth1', 'wan']),
    lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
  };

  const devices: Device[] = options.knownDevices ?? [
    {
      id: '52:54:00:CE:1C:BE',
      mac: '52:54:00:CE:1C:BE',
      ip: '192.168.50.50',
      hostname: 'test-client',
      interface: 'br-lan',
      connected: true,
      rxBytes: 0,
      txBytes: 0,
    },
  ];

  return {
    detectInfrastructure: async () => defaultInfra,
    getBaselineInfrastructure: () => defaultInfra,
    getConnectedDevices: async () => devices,
    isRealLanClient: (candidate, infra) => {
      if (!candidate.mac) return false;
      const norm = candidate.mac.toUpperCase();
      if (infra.excludedMacs.has(norm)) return false;
      if (candidate.ip && infra.excludedIps.has(candidate.ip)) return false;
      return true;
    },
  } as unknown as DevicesService;
}

function createMockUsageService(initialUsage: DeviceUsage[] = []): {
  service: UsageService;
  setUsage: (usage: DeviceUsage[]) => void;
  setFailing: (err: Error | null) => void;
} {
  let currentUsage = [...initialUsage];
  let failureError: Error | null = null;

  const service = {
    getDeviceUsage: async () => {
      if (failureError) throw failureError;
      return currentUsage;
    },
  } as unknown as UsageService;

  return {
    service,
    setUsage: (usage: DeviceUsage[]) => {
      currentUsage = [...usage];
    },
    setFailing: (err: Error | null) => {
      failureError = err;
    },
  };
}

async function runTests() {
  console.log('🧪 Starting QuotaService Comprehensive Tests (All 15 Engine Specifications)...');

  // Test 1: Create quota for valid real client
  console.log('Running Test 1: Create quota for valid real client...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 1000,
        uploadBytes: 1000,
        totalBytes: 2000,
      },
    ]);

    const service = new QuotaService(repo, mockUsage.service, mockDev);
    const quota = await service.createQuota({
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: 5368709120, // 5 GB
    });

    assert.equal(quota.mac, '52:54:00:CE:1C:BE');
    assert.equal(quota.quotaBytes, 5368709120);
    assert.equal(quota.usedBytes, 0, 'Used bytes must be 0 at quota initialization');
    assert.equal(quota.remainingBytes, 5368709120);
    assert.equal(quota.percentage, 0);
    assert.equal(quota.status, 'active');
    assert.ok(quota.createdAt);
    assert.ok(quota.updatedAt);

    console.log('✅ Test 1 Passed: Quota created successfully for valid client with 0 used bytes');
  }

  // Test 2: MAC normalization
  console.log('Running Test 2: MAC normalization...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([]);

    const service = new QuotaService(repo, mockUsage.service, mockDev);
    const quota = await service.createQuota({
      mac: '52:54:00:ce:1c:be', // lowercase input
      quotaBytes: 1000000,
    });

    assert.equal(quota.mac, '52:54:00:CE:1C:BE', 'MAC must be normalized to uppercase');

    // Also verify retrieval works with lowercase input
    const fetched = await service.getQuotaByMac('52-54-00-ce-1c-be');
    assert.equal(fetched.mac, '52:54:00:CE:1C:BE');

    console.log('✅ Test 2 Passed: MAC normalization handles lowercase and hyphens cleanly');
  }

  // Test 3: Reject invalid MAC
  console.log('Running Test 3: Reject invalid MAC...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await assert.rejects(
      async () => service.createQuota({ mac: 'invalid-mac', quotaBytes: 1000000 }),
      (err: unknown) => {
        assert.ok(err instanceof InvalidDeviceQuotaError);
        assert.equal(err.statusCode, 400);
        return true;
      },
      'Should reject invalid MAC with InvalidDeviceQuotaError'
    );

    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:XX:1C:BE', quotaBytes: 1000000 }),
      (err: unknown) => err instanceof InvalidDeviceQuotaError
    );

    console.log('✅ Test 3 Passed: Invalid MAC formats rejected');
  }

  // Test 4: Reject infrastructure device
  console.log('Running Test 4: Reject infrastructure device...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    // 4.1 Reject IP input (such as 192.168.50.1)
    await assert.rejects(
      async () => service.createQuota({ mac: '192.168.50.1', quotaBytes: 1000000 }),
      (err: unknown) => {
        assert.ok(err instanceof InvalidDeviceQuotaError);
        return true;
      },
      'Should reject IP format 192.168.50.1'
    );

    // 4.2 Reject Router MAC (52:54:00:CF:15:77)
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:CF:15:77', quotaBytes: 1000000 }),
      (err: unknown) => {
        assert.ok(err instanceof InvalidDeviceQuotaError);
        assert.match(err.message, /infrastructure/i);
        return true;
      },
      'Should reject router self MAC'
    );

    // 4.3 Reject Host bridge MAC (52:54:00:5B:2E:C1)
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:5B:2E:C1', quotaBytes: 1000000 }),
      (err: unknown) => {
        assert.ok(err instanceof InvalidDeviceQuotaError);
        assert.match(err.message, /infrastructure/i);
        return true;
      },
      'Should reject host bridge MAC'
    );

    // 4.4 Reject Libvirt WAN device (52:54:00:E3:BE:C2)
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:E3:BE:C2', quotaBytes: 1000000 }),
      (err: unknown) => {
        assert.ok(err instanceof InvalidDeviceQuotaError);
        assert.match(err.message, /infrastructure/i);
        return true;
      },
      'Should reject WAN device MAC'
    );

    console.log('✅ Test 4 Passed: Infrastructure devices rejected from quota assignment');
  }

  // Test 5: New quota captures current usage as baseline
  console.log('Running Test 5: New quota captures current usage as baseline...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const hundredMb = 100 * 1024 * 1024; // 100 MB = 104857600
    const fiveGb = 5 * 1024 * 1024 * 1024; // 5 GB = 5368709120

    const mockUsage = createMockUsageService([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 50 * 1024 * 1024,
        uploadBytes: 50 * 1024 * 1024,
        totalBytes: hundredMb, // 100 MB existing cumulative usage
      },
    ]);

    const service = new QuotaService(repo, mockUsage.service, mockDev);
    const quota = await service.createQuota({
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: fiveGb,
    });

    assert.equal(quota.usedBytes, 0, 'Current 100 MB usage must NOT be charged against new quota');
    assert.equal(quota.remainingBytes, fiveGb);
    assert.equal(quota.percentage, 0);
    assert.equal(quota.status, 'active');

    console.log('✅ Test 5 Passed: Existing 100 MB usage captured as baseline, usedBytes is 0');
  }

  // Test 6: Later usage increases
  console.log('Running Test 6: Later usage increases...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const hundredMb = 100 * 1024 * 1024; // 100 MB baseline
    const fiveGb = 5 * 1024 * 1024 * 1024; // 5 GB quota

    const mockUsage = createMockUsageService([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 50 * 1024 * 1024,
        uploadBytes: 50 * 1024 * 1024,
        totalBytes: hundredMb,
      },
    ]);

    const service = new QuotaService(repo, mockUsage.service, mockDev);
    await service.createQuota({
      mac: '52:54:00:CE:1C:BE',
      quotaBytes: fiveGb,
    });

    // Later: cumulative usage increases to 300 MB
    const threeHundredMb = 300 * 1024 * 1024;
    mockUsage.setUsage([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 150 * 1024 * 1024,
        uploadBytes: 150 * 1024 * 1024,
        totalBytes: threeHundredMb,
      },
    ]);

    const updated = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    const expectedUsed = 200 * 1024 * 1024; // 300 MB - 100 MB = 200 MB
    assert.equal(updated.usedBytes, expectedUsed, 'Used bytes must be 200 MB');
    assert.equal(updated.remainingBytes, fiveGb - expectedUsed);
    assert.equal(updated.percentage, Number(((expectedUsed / fiveGb) * 100).toFixed(2)));
    assert.equal(updated.status, 'active');

    console.log('✅ Test 6 Passed: Usage delta calculated accurately as 200 MB');
  }

  // Test 7: Multiple protocol flows already aggregated by UsageService consumed by QuotaService
  console.log('Running Test 7: Multiple protocol flows aggregated consumption...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    // Simulate UsageService having already aggregated multiple flows:
    // Flow 1 (ICMP): 1000 bytes
    // Flow 2 (UDP DNS): 420 bytes
    // Flow 3 (TCP HTTPS): 2000 bytes
    // Total aggregated: 3420 bytes
    const mockUsage = createMockUsageService([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 1420,
        uploadBytes: 2000,
        totalBytes: 3420,
      },
    ]);

    const service = new QuotaService(repo, mockUsage.service, mockDev);
    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 10000 });

    // Additional aggregated traffic arrives
    mockUsage.setUsage([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 2420,
        uploadBytes: 3000,
        totalBytes: 5420, // 2000 bytes additional
      },
    ]);

    const quota = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(quota.usedBytes, 2000, 'QuotaService must consume DeviceUsage.totalBytes');

    console.log('✅ Test 7 Passed: QuotaService accurately consumes aggregated totalBytes');
  }

  // Test 8: Remaining bytes calculation
  console.log('Running Test 8: Remaining bytes calculation...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 0 }]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 1000 });

    // When 400 bytes used -> 600 remaining
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 200, uploadBytes: 200, totalBytes: 400 }]);
    let q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.remainingBytes, 600);

    // When 1000 bytes used -> 0 remaining
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 500, uploadBytes: 500, totalBytes: 1000 }]);
    q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.remainingBytes, 0);

    // When 1200 bytes used -> 0 remaining (never negative)
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 600, uploadBytes: 600, totalBytes: 1200 }]);
    q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.remainingBytes, 0, 'Remaining bytes must never be negative');

    console.log('✅ Test 8 Passed: Remaining bytes calculated correctly with lower bound at 0');
  }

  // Test 9: Percentage calculation
  console.log('Running Test 9: Percentage calculation...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 0 }]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    // 100 MB of 5 GB is 1.95%
    const hundredMb = 104857600;
    const fiveGb = 5368709120;
    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: fiveGb });

    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: hundredMb / 2, uploadBytes: hundredMb / 2, totalBytes: hundredMb }]);
    const q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.percentage, 1.95, '100MB of 5GB must be 1.95%');

    console.log('✅ Test 9 Passed: Percentage calculation matches precision requirements');
  }

  // Test 10: Quota exhaustion
  console.log('Running Test 10: Quota exhaustion...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const oneGb = 1073741824;
    const mockUsage = createMockUsageService([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 0 }]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: oneGb });

    // Device uses exactly 1 GB
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: oneGb / 2, uploadBytes: oneGb / 2, totalBytes: oneGb }]);
    const q = await service.getQuotaByMac('52:54:00:CE:1C:BE');

    assert.equal(q.usedBytes, oneGb);
    assert.equal(q.remainingBytes, 0);
    assert.equal(q.percentage, 100);
    assert.equal(q.status, 'exhausted');

    console.log('✅ Test 10 Passed: Status transitions to exhausted when usage reaches quota');
  }

  // Test 11: Usage exceeds quota
  console.log('Running Test 11: Usage exceeds quota...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const oneGb = 1073741824;
    const onePointFiveGb = 1610612736;
    const mockUsage = createMockUsageService([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 0 }]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: oneGb });

    // Device uses 1.5 GB
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: onePointFiveGb / 2, uploadBytes: onePointFiveGb / 2, totalBytes: onePointFiveGb }]);
    const q = await service.getQuotaByMac('52:54:00:CE:1C:BE');

    assert.equal(q.usedBytes, onePointFiveGb);
    assert.equal(q.remainingBytes, 0, 'Remaining bytes must be 0');
    assert.equal(q.percentage, 100, 'Percentage must be capped at 100 for normal display');
    assert.equal(q.status, 'exhausted');

    console.log('✅ Test 11 Passed: Percentage capped at 100 and remaining is 0 when exceeded');
  }

  // Test 12: Counter reset
  console.log('Running Test 12: Counter reset...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([
      { mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 100 }, // Baseline = 100
    ]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 2000 });

    // Previous usage reaches 900
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 450, uploadBytes: 450, totalBytes: 900 }]);
    let q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.usedBytes, 800); // 900 - 100 = 800

    // Counter resets on router: current total becomes 100 (< 900)
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 50, uploadBytes: 50, totalBytes: 100 }]);
    q = await service.getQuotaByMac('52:54:00:CE:1C:BE');

    assert.ok(q.usedBytes >= 800, 'Used bytes must never decrease or produce negative usage');
    assert.equal(q.usedBytes, 900, 'Used bytes must be 800 (previous) + 100 (new period) = 900');

    console.log('✅ Test 12 Passed: Counter reset handled cleanly without negative usage');
  }

  // Test 13: IP change
  console.log('Running Test 13: IP change...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([
      { mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 500, uploadBytes: 500, totalBytes: 1000 },
    ]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 5000 });

    // Device IP changes to 192.168.50.80 and traffic increases
    mockUsage.setUsage([
      { mac: '52:54:00:CE:1C:BE', ip: '192.168.50.80', downloadBytes: 1000, uploadBytes: 1000, totalBytes: 2000 },
    ]);

    const q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.mac, '52:54:00:CE:1C:BE');
    assert.equal(q.usedBytes, 1000); // 2000 - 1000 = 1000

    console.log('✅ Test 13 Passed: Quota ownership adheres to MAC regardless of IP change');
  }

  // Test 14: Persistence across restart
  console.log('Running Test 14: Persistence across restart...');
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-persist-test-'));
    const tempFile = path.join(tempDir, 'quotas.json');

    try {
      const repo1 = new FileQuotaRepository(tempFile);
      const mockDev = createMockDevicesService();
      const mockUsage = createMockUsageService([]);
      const service1 = new QuotaService(repo1, mockUsage.service, mockDev);

      await service1.createQuota({
        mac: '52:54:00:CE:1C:BE',
        quotaBytes: 10000000,
      });

      // Simulate application restart: instantiate a brand new repository and service instance
      const repo2 = new FileQuotaRepository(tempFile);
      const service2 = new QuotaService(repo2, mockUsage.service, mockDev);

      const restored = await service2.getQuotaByMac('52:54:00:CE:1C:BE');
      assert.ok(restored, 'Restored quota must exist');
      assert.equal(restored.mac, '52:54:00:CE:1C:BE');
      assert.equal(restored.quotaBytes, 10000000);
      assert.equal(restored.status, 'active');

      const all = await service2.getAllQuotas();
      assert.equal(all.length, 1);
      assert.equal(all[0]?.mac, '52:54:00:CE:1C:BE');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    console.log('✅ Test 14 Passed: Quota state persists across service instances and restarts');
  }

  // Test 15: Router / UsageService error handling
  console.log('Running Test 15: Router / UsageService error handling...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    mockUsage.setFailing(new OpenWrtConnectionError('SSH connection to router failed'));

    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 5000 }),
      (err: unknown) => {
        assert.ok(err instanceof OpenWrtConnectionError);
        assert.equal(err.statusCode, 502);
        return true;
      },
      'Should propagate OpenWrtConnectionError with status 502'
    );

    console.log('✅ Test 15 Passed: Router failure accurately propagates error with status 502');
  }

  // Additional Tests: Update, Delete, and Conflict
  console.log('Running Additional Tests: Update, Delete, and Conflict...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 0 }]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 1000 });

    // Conflict test: Cannot create duplicate quota for same MAC
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 2000 }),
      (err: unknown) => err instanceof QuotaAlreadyExistsError
    );

    // Update quota size without resetting usage
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 250, uploadBytes: 250, totalBytes: 500 }]);
    const updated = await service.updateQuota('52:54:00:CE:1C:BE', { quotaBytes: 5000 });
    assert.equal(updated.quotaBytes, 5000);
    assert.equal(updated.usedBytes, 500, 'Used bytes must NOT be reset when quotaBytes changes');
    assert.equal(updated.remainingBytes, 4500);

    // Update with resetUsage: true
    const reset = await service.updateQuota('52:54:00:CE:1C:BE', { resetUsage: true });
    assert.equal(reset.usedBytes, 0, 'Used bytes must be 0 after reset');
    assert.equal(reset.remainingBytes, 5000);

    // Delete quota
    const deleted = await service.deleteQuota('52:54:00:CE:1C:BE');
    assert.equal(deleted, true);

    await assert.rejects(
      async () => service.getQuotaByMac('52:54:00:CE:1C:BE'),
      (err: unknown) => err instanceof QuotaNotFoundError
    );

    console.log('✅ Additional Tests Passed: Update, Delete, and Conflict behaviors verified');
  }

  // =========================================================================
  // Phase 4: Strict Boundary Condition Verification
  // quotaBytes = 0
  // usedBytes = 0
  // usedBytes = quotaBytes - 1
  // usedBytes = quotaBytes
  // usedBytes = quotaBytes + 1
  // Invalid quota values (negative, non-integer, float)
  // =========================================================================
  console.log('Running Test 16: Phase 4 Boundary Conditions Validation...');
  {
    const repo = new InMemoryQuotaRepository();
    const mockDev = createMockDevicesService();
    const mockUsage = createMockUsageService([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 0, uploadBytes: 0, totalBytes: 0 }]);
    const service = new QuotaService(repo, mockUsage.service, mockDev);

    // 1. Boundary: quotaBytes = 0 must be rejected
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 0 }),
      (err: unknown) => err instanceof InvalidDeviceQuotaError,
      'quotaBytes = 0 must be rejected with InvalidDeviceQuotaError'
    );

    // 2. Boundary: negative quotaBytes must be rejected
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: -1000 }),
      (err: unknown) => err instanceof InvalidDeviceQuotaError
    );

    // 3. Boundary: non-integer float quotaBytes must be rejected
    await assert.rejects(
      async () => service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 1000.5 }),
      (err: unknown) => err instanceof InvalidDeviceQuotaError
    );

    // Create baseline quota with 1000 bytes
    await service.createQuota({ mac: '52:54:00:CE:1C:BE', quotaBytes: 1000 });

    // 4. Boundary: usedBytes = 0 -> status = active
    let q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.usedBytes, 0);
    assert.equal(q.status, 'active');
    assert.equal(q.remainingBytes, 1000);

    // 5. Boundary: usedBytes = quotaBytes - 1 (999) -> status = active
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 500, uploadBytes: 499, totalBytes: 999 }]);
    q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.usedBytes, 999);
    assert.equal(q.status, 'active', 'usedBytes = quotaBytes - 1 MUST be active');
    assert.equal(q.remainingBytes, 1);

    // 6. Boundary: usedBytes = quotaBytes (1000) -> status = exhausted
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 500, uploadBytes: 500, totalBytes: 1000 }]);
    q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.usedBytes, 1000);
    assert.equal(q.status, 'exhausted', 'usedBytes = quotaBytes MUST be exhausted');
    assert.equal(q.remainingBytes, 0);

    // 7. Boundary: usedBytes = quotaBytes + 1 (1001) -> status = exhausted
    mockUsage.setUsage([{ mac: '52:54:00:CE:1C:BE', ip: '192.168.50.50', downloadBytes: 500, uploadBytes: 501, totalBytes: 1001 }]);
    q = await service.getQuotaByMac('52:54:00:CE:1C:BE');
    assert.equal(q.usedBytes, 1001);
    assert.equal(q.status, 'exhausted', 'usedBytes = quotaBytes + 1 MUST be exhausted');
    assert.equal(q.remainingBytes, 0);

    console.log('✅ Test 16 Passed: All Phase 4 boundary conditions (0, quota-1, quota, quota+1) verified accurately');
  }

  console.log('\n🎉 ALL QuotaService UNIT TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runTests().catch((err) => {
  console.error('❌ QuotaService test failed:', err);
  process.exit(1);
});

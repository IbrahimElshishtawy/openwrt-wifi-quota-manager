import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { quotaRoutes } from '../src/modules/quota/quota.routes.js';
import { QuotaService } from '../src/modules/quota/QuotaService.js';
import { InMemoryQuotaRepository } from '../src/modules/quota/storage/InMemoryQuotaRepository.js';
import type { UsageService } from '../src/modules/usage/UsageService.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';
import {
  OpenWrtConnectionError,
  UbusAuthenticationError,
  OpenWrtNotConfiguredError,
} from '../src/infrastructure/openwrt/UbusClient.js';
import {
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
} from '../src/modules/quota/types.js';

function createMockDependencies() {
  const repo = new InMemoryQuotaRepository();

  const infra: InfrastructureMetadata = {
    excludedIps: new Set(['192.168.50.1', '192.168.50.254', '192.168.122.1']),
    excludedMacs: new Set(['00:00:00:00:00:00', '52:54:00:CF:15:77', '52:54:00:5B:2E:C1', '52:54:00:E3:BE:C2']),
    excludedHostnames: new Set(['openwrt']),
    wanDevices: new Set(['eth1', 'wan']),
    lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
  };

  const devices: Device[] = [
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

  const devicesServiceMock = {
    detectInfrastructure: async () => infra,
    getBaselineInfrastructure: () => infra,
    getConnectedDevices: async () => devices,
    isRealLanClient: (candidate: { mac: string; ip: string | null }, currentInfra: InfrastructureMetadata) => {
      const norm = candidate.mac.toUpperCase();
      if (currentInfra.excludedMacs.has(norm)) return false;
      if (candidate.ip && currentInfra.excludedIps.has(candidate.ip)) return false;
      return true;
    },
  } as unknown as DevicesService;

  let currentUsage = [
    {
      mac: '52:54:00:CE:1C:BE',
      ip: '192.168.50.50',
      downloadBytes: 1000,
      uploadBytes: 1000,
      totalBytes: 2000,
    },
  ];

  let shouldFail = false;

  const usageServiceMock = {
    getDeviceUsage: async () => {
      if (shouldFail) throw new OpenWrtConnectionError('Failed to connect to router');
      return currentUsage;
    },
  } as unknown as UsageService;

  const service = new QuotaService(repo, usageServiceMock, devicesServiceMock);

  return {
    service,
    setUsage: (usage: typeof currentUsage) => {
      currentUsage = usage;
    },
    setFail: (fail: boolean) => {
      shouldFail = fail;
    },
  };
}

function buildTestApp(service: QuotaService) {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof OpenWrtConnectionError ||
      error instanceof UbusAuthenticationError ||
      error instanceof OpenWrtNotConfiguredError ||
      error instanceof QuotaNotFoundError ||
      error instanceof QuotaAlreadyExistsError ||
      error instanceof InvalidDeviceQuotaError
    ) {
      const statusCode = (error as { statusCode?: number }).statusCode || 502;
      return reply.status(statusCode).send({
        statusCode,
        error: error.name,
        code: (error as { code?: string }).code,
        message: error.message,
        success: false,
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: error.validation,
      });
    }

    return reply.status(500).send(error);
  });

  return app;
}

async function runRouteTests() {
  console.log('🧪 Starting QuotaRoutes HTTP Integration tests...');

  const { service, setUsage, setFail } = createMockDependencies();
  const app = buildTestApp(service);
  await app.register(quotaRoutes, { service });

  // 1. Test POST /api/quotas (Create quota)
  console.log('Testing POST /api/quotas...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: {
        mac: '52:54:00:ce:1c:be', // test lowercase normalization
        quotaBytes: 5368709120,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.mac, '52:54:00:CE:1C:BE');
    assert.equal(body.data.quotaBytes, 5368709120);
    assert.equal(body.data.usedBytes, 0);
    assert.equal(body.data.remainingBytes, 5368709120);
    assert.equal(body.data.percentage, 0);
    assert.equal(body.data.status, 'active');
    console.log('✅ POST /api/quotas succeeded with 201 Created');
  }

  // 2. Test duplicate POST /api/quotas -> 409 Conflict
  console.log('Testing duplicate POST /api/quotas...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: {
        mac: '52:54:00:CE:1C:BE',
        quotaBytes: 1000000,
      },
    });

    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'QUOTA_ALREADY_EXISTS');
    console.log('✅ Duplicate quota rejected with 409 Conflict');
  }

  // 3. Test POST with invalid MAC -> 400 Bad Request
  console.log('Testing POST /api/quotas with invalid MAC...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: {
        mac: 'invalid-mac',
        quotaBytes: 1000,
      },
    });

    assert.equal(res.statusCode, 400);
    console.log('✅ Invalid MAC rejected with 400 Bad Request');
  }

  // 4. Test POST with infrastructure MAC -> 400 Bad Request
  console.log('Testing POST /api/quotas with router infrastructure MAC...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: {
        mac: '52:54:00:CF:15:77', // Router MAC
        quotaBytes: 1000,
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.match(body.message, /infrastructure/i);
    console.log('✅ Infrastructure MAC rejected with 400 Bad Request');
  }

  // 5. Test GET /api/quotas (Get all quotas with fresh telemetry)
  console.log('Testing GET /api/quotas...');
  {
    // Simulate usage increase to 104857600 (100 MB)
    setUsage([
      {
        mac: '52:54:00:CE:1C:BE',
        ip: '192.168.50.50',
        downloadBytes: 52428800,
        uploadBytes: 52428800,
        totalBytes: 104857600 + 2000, // 100MB over baseline
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/quotas',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.count, 1);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].mac, '52:54:00:CE:1C:BE');
    assert.equal(body.data[0].usedBytes, 104857600);
    assert.equal(body.data[0].percentage, 1.95);
    assert.equal(body.data[0].status, 'active');
    console.log('✅ GET /api/quotas returned 200 with refreshed telemetry');
  }

  // 6. Test GET /api/quotas/:mac
  console.log('Testing GET /api/quotas/:mac...');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quotas/52:54:00:ce:1c:be',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.mac, '52:54:00:CE:1C:BE');
    assert.equal(body.data.usedBytes, 104857600);
    console.log('✅ GET /api/quotas/:mac returned 200 with single device quota');
  }

  // 7. Test GET /api/quotas/:mac Not Found -> 404
  console.log('Testing GET /api/quotas/:mac with non-existent quota...');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/quotas/AA:BB:CC:DD:EE:FF',
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'QUOTA_NOT_FOUND');
    console.log('✅ Non-existent quota returned 404 Not Found');
  }

  // 8. Test PATCH /api/quotas/:mac
  console.log('Testing PATCH /api/quotas/:mac (update limit)...');
  {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quotas/52:54:00:CE:1C:BE',
      payload: {
        quotaBytes: 10737418240, // 10 GB
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.quotaBytes, 10737418240);
    assert.equal(body.data.usedBytes, 104857600, 'Used bytes must NOT be reset on quotaBytes change');
    console.log('✅ PATCH /api/quotas/:mac updated quotaBytes preserving usedBytes');
  }

  // 9. Test PATCH /api/quotas/:mac with resetUsage: true
  console.log('Testing PATCH /api/quotas/:mac (explicit resetUsage)...');
  {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quotas/52:54:00:CE:1C:BE',
      payload: {
        resetUsage: true,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.usedBytes, 0, 'Used bytes must be reset to 0');
    assert.equal(body.data.remainingBytes, 10737418240);
    console.log('✅ PATCH /api/quotas/:mac explicitly reset usage to 0');
  }

  // 10. Test DELETE /api/quotas/:mac
  console.log('Testing DELETE /api/quotas/:mac...');
  {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/quotas/52:54:00:CE:1C:BE',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.match(body.message, /removed/i);

    // Verify subsequent GET returns 404
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/quotas/52:54:00:CE:1C:BE',
    });
    assert.equal(getRes.statusCode, 404);
    console.log('✅ DELETE /api/quotas/:mac removed quota cleanly');
  }

  // 11. Test Router Error propagation -> 502 Bad Gateway
  console.log('Testing router error response mapping (502)...');
  {
    setFail(true);
    const res = await app.inject({
      method: 'GET',
      url: '/api/quotas',
    });

    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.statusCode, 502);
    console.log('✅ Router connection error mapped to 502 Bad Gateway');
  }

  // 12. Test Compatibility Aliases (/quotas)
  console.log('Testing compatibility aliases /quotas...');
  {
    setFail(false);
    const res = await app.inject({
      method: 'GET',
      url: '/quotas',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    console.log('✅ Compatibility route /quotas responded with status 200');
  }

  console.log('\n🎉 ALL QuotaRoutes HTTP TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runRouteTests().catch((err) => {
  console.error('❌ QuotaRoutes test failed:', err);
  process.exit(1);
});

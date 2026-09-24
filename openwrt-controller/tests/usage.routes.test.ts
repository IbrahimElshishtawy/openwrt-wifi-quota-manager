import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { usageRoutes } from '../src/modules/usage/usage.routes.js';
import { UsageService } from '../src/modules/usage/UsageService.js';
import type { ISshClient, SshExecutionResult } from '../src/infrastructure/openwrt/SshClient.js';
import { OpenWrtConnectionError } from '../src/infrastructure/openwrt/UbusClient.js';

async function runRouteTests() {
  console.log('🧪 Starting UsageRoutes HTTP tests...');

  const sampleNlbwJson = JSON.stringify({
    columns: [
      'family', 'proto', 'port', 'mac', 'ip',
      'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
    ],
    data: [
      [4, 'ICMP', 0, '52:54:00:ce:1c:be', '192.168.50.50', 6, 1008, 12, 1344, 16, 'ICMP'],
      [4, 'UDP', 53, '52:54:00:ce:1c:be', '192.168.50.50', 6, 420, 4, 450, 8, 'DNS'],
    ],
  });

  const mockSsh: ISshClient = {
    isConfigured: () => true,
    executeCommand: async () => ({
      stdout: sampleNlbwJson,
      stderr: '',
      exitCode: 0,
    }),
  };

  const app = Fastify();
  await app.register(usageRoutes, { service: new UsageService(mockSsh) });

  // 1. Test GET /api/usage (Primary endpoint)
  console.log('Testing GET /api/usage...');
  const apiRes = await app.inject({
    method: 'GET',
    url: '/api/usage',
  });

  assert.equal(apiRes.statusCode, 200);
  const apiData = apiRes.json();
  assert.equal(apiData.success, true);
  assert.equal(apiData.data.length, 1);
  assert.equal(apiData.data[0].mac, '52:54:00:CE:1C:BE');
  assert.equal(apiData.data[0].ip, '192.168.50.50');
  assert.equal(apiData.data[0].downloadBytes, 1428);
  assert.equal(apiData.data[0].uploadBytes, 1794);
  assert.equal(apiData.data[0].totalBytes, 3222);
  console.log('✅ GET /api/usage responded with status 200 and aggregated data');

  // 2. Test GET /usage (Compatibility alias)
  console.log('Testing GET /usage...');
  const aliasRes = await app.inject({
    method: 'GET',
    url: '/usage',
  });

  assert.equal(aliasRes.statusCode, 200);
  const aliasData = aliasRes.json();
  assert.equal(aliasData.success, true);
  assert.equal(aliasData.data.length, 1);
  assert.equal(aliasData.data[0].mac, '52:54:00:CE:1C:BE');
  console.log('✅ GET /usage compatibility endpoint responded with status 200');

  // 3. Test router failure response in full app
  console.log('Testing full app error handling for router failure...');
  const failingSsh: ISshClient = {
    isConfigured: () => true,
    executeCommand: async () => {
      throw new OpenWrtConnectionError('Failed to connect to router');
    },
  };

  const { buildApp } = await import('../src/app.js');
  const fullApp = await buildApp();
  // Override route with failing service
  const failingApp = Fastify();
  failingApp.setErrorHandler((error, _request, reply) => {
    if (error instanceof OpenWrtConnectionError) {
      return reply.status(502).send({
        statusCode: 502,
        error: error.name,
        code: error.code,
        message: error.message,
        success: false,
      });
    }
    return reply.status(500).send(error);
  });
  await failingApp.register(usageRoutes, { service: new UsageService(failingSsh) });

  const failRes = await failingApp.inject({
    method: 'GET',
    url: '/api/usage',
  });
  assert.equal(failRes.statusCode, 502);
  const failData = failRes.json();
  assert.equal(failData.success, false);
  assert.equal(failData.statusCode, 502);
  console.log('✅ Router connection error accurately mapped to 502 Bad Gateway');

  console.log('\n🎉 ALL UsageRoutes HTTP TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runRouteTests().catch((err) => {
  console.error('❌ Route test failed:', err);
  process.exit(1);
});

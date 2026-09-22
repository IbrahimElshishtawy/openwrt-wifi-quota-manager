import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { devicesRoutes } from '../src/modules/devices/devices.routes.js';
import { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { UbusClient } from '../src/infrastructure/openwrt/UbusClient.js';

async function runRouteTests() {
  console.log('🧪 Starting DeviceRoutes HTTP tests...');

  const mockUbus = {
    isConfigured: () => true,
    login: async () => 'mock-token',
    call: async <T>(object: string, method: string): Promise<T> => {
      if (object === 'luci-rpc' && method === 'getDHCPLeases') {
        return {
          dhcp_leases: [
            {
              macaddr: '52:54:00:AA:BB:CC',
              ipaddr: '192.168.50.101',
              hostname: 'my-phone',
              expires: 1727028123,
            },
          ],
        } as unknown as T;
      }
      return {} as unknown as T;
    },
  } as unknown as UbusClient;

  const app = Fastify();
  await app.register(devicesRoutes, { service: new DevicesService(mockUbus) });

  // 1. Test GET /api/devices (Primary endpoint)
  const apiRes = await app.inject({
    method: 'GET',
    url: '/api/devices',
  });

  assert.equal(apiRes.statusCode, 200);
  const apiData = apiRes.json();
  assert.equal(apiData.success, true);
  assert.equal(apiData.count, 1);
  assert.equal(apiData.data.length, 1);
  assert.equal(apiData.data[0].hostname, 'my-phone');
  assert.equal(apiData.data[0].mac, '52:54:00:AA:BB:CC');
  assert.equal(apiData.data[0].id, '52:54:00:aa:bb:cc');

  // 2. Test GET /devices (Compatibility endpoint)
  const compatRes = await app.inject({
    method: 'GET',
    url: '/devices',
  });

  assert.equal(compatRes.statusCode, 200);
  const compatData = compatRes.json();
  assert.equal(compatData.success, true);
  assert.equal(compatData.devices[0].hostname, 'my-phone');

  // 3. Test query filter
  const filterRes = await app.inject({
    method: 'GET',
    url: '/api/devices?search=nonexistent',
  });
  assert.equal(filterRes.statusCode, 200);
  assert.equal(filterRes.json().count, 0);

  console.log('✅ All DeviceRoutes HTTP tests passed successfully!');
}

runRouteTests().catch((err) => {
  console.error('❌ Route test failed:', err);
  process.exit(1);
});

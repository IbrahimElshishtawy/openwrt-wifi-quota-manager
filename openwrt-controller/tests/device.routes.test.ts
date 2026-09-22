import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { deviceRoutes } from '../src/modules/devices/device.routes.js';
import { DeviceService } from '../src/modules/devices/device.service.js';
import type { UbusClient, RawDhcpLeaseEntry, RawArpEntry } from '../src/infrastructure/openwrt/ubus.client.js';

async function runRouteTests() {
  console.log('🧪 Starting DeviceRoutes HTTP tests...');

  const mockUbus = {
    isConfigured: () => true,
    getDhcpLeases: async (): Promise<RawDhcpLeaseEntry[]> => [
      {
        mac: '52:54:00:AA:BB:CC',
        ip: '192.168.50.101',
        hostname: 'my-phone',
        expires: 1727028123,
      },
    ],
    getArpTable: async (): Promise<RawArpEntry[]> => [],
  } as unknown as UbusClient;

  const app = Fastify();
  await app.register(deviceRoutes, { service: new DeviceService(mockUbus) });

  // 1. Test GET /devices
  const res = await app.inject({
    method: 'GET',
    url: '/devices',
  });

  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.count, 1);
  assert.equal(data.devices[0].hostname, 'my-phone');
  assert.equal(data.devices[0].mac, '52:54:00:AA:BB:CC');

  // 2. Test query filter
  const filterRes = await app.inject({
    method: 'GET',
    url: '/devices?search=nonexistent',
  });
  assert.equal(filterRes.statusCode, 200);
  assert.equal(filterRes.json().count, 0);

  // 3. Test invalid status query
  const badRes = await app.inject({
    method: 'GET',
    url: '/devices?status=unknown_bad_status',
  });
  assert.equal(badRes.statusCode, 400);

  console.log('✅ All DeviceRoutes HTTP tests passed successfully!');
}

runRouteTests().catch((err) => {
  console.error('❌ Route test failed:', err);
  process.exit(1);
});

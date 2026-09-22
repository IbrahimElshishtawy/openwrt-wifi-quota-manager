import assert from 'node:assert/strict';
import { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { UbusClient } from '../src/infrastructure/openwrt/UbusClient.js';

async function runTests() {
  console.log('🧪 Starting DevicesService tests...');

  // Mock generic UbusClient
  const mockUbus = {
    isConfigured: () => true,
    login: async () => 'mock-session-token',
    call: async <T>(object: string, method: string): Promise<T> => {
      if (object === 'luci-rpc' && method === 'getDHCPLeases') {
        return {
          dhcp_leases: [
            {
              macaddr: '52:54:00:CF:15:88',
              ipaddr: '192.168.50.150',
              hostname: 'test-client',
              expires: 1727028123,
            },
            {
              macaddr: '52:54:00:11:22:33',
              ipaddr: '192.168.50.100',
              hostname: '*',
              expires: 1727028199,
            },
          ],
        } as unknown as T;
      }

      if (object === 'luci-rpc' && method === 'getHostHints') {
        return {
          '52:54:00:CF:15:88': {
            ipaddrs: ['192.168.50.150'],
            name: 'test-client',
          },
          'AA:BB:CC:DD:EE:FF': {
            ipaddrs: ['192.168.50.200'],
            name: 'static-device',
          },
        } as unknown as T;
      }

      if (object === 'file' && method === 'exec') {
        return {
          code: 0,
          stdout:
            '192.168.50.150 dev br-lan lladdr 52:54:00:cf:15:88 ref 1 used 0/0/0 probes 1 REACHABLE\n' +
            '192.168.50.200 dev br-lan lladdr aa:bb:cc:dd:ee:ff ref 1 used 0/0/0 probes 1 REACHABLE\n',
        } as unknown as T;
      }

      return {} as unknown as T;
    },
  } as unknown as UbusClient;

  const service = new DevicesService(mockUbus);
  const devices = await service.getConnectedDevices();

  assert.equal(devices.length, 3, 'Should discover 3 distinct devices');

  // Verify DHCP lease device
  const dev1 = devices.find((d) => d.mac === '52:54:00:CF:15:88');
  assert.ok(dev1, 'Should find test-client device');
  assert.equal(dev1.id, '52:54:00:cf:15:88');
  assert.equal(dev1.hostname, 'test-client');
  assert.equal(dev1.ip, '192.168.50.150');
  assert.equal(dev1.connected, true);
  assert.equal(dev1.interface, 'br-lan');
  assert.equal(dev1.rxBytes, 0);
  assert.equal(dev1.txBytes, 0);

  // Verify hostname normalization for '*'
  const dev2 = devices.find((d) => d.mac === '52:54:00:11:22:33');
  assert.ok(dev2);
  assert.equal(dev2.hostname, null, 'Should normalize * to null');

  // Verify static ARP device
  const dev3 = devices.find((d) => d.mac === 'AA:BB:CC:DD:EE:FF');
  assert.ok(dev3, 'Should discover static device from ARP table');
  assert.equal(dev3.ip, '192.168.50.200');
  assert.equal(dev3.connected, true);
  assert.equal(dev3.interface, 'br-lan');

  // Verify search filtering
  const filtered = await service.getConnectedDevices({ search: 'test-client' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.mac, '52:54:00:CF:15:88');

  // Verify interface filtering
  const filteredByIface = await service.getConnectedDevices({ interface: 'br-lan' });
  assert.equal(filteredByIface.length, 2);

  console.log('✅ All DevicesService tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

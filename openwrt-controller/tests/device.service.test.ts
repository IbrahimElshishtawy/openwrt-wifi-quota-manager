import assert from 'node:assert/strict';
import { DevicesService, normalizeMac } from '../src/modules/devices/DevicesService.js';
import type { UbusClient } from '../src/infrastructure/openwrt/UbusClient.js';

async function runTests() {
  console.log('🧪 Starting DevicesService Comprehensive Tests...');

  // Mock UbusClient with full router topology and multi-source device data
  const mockUbus = {
    isConfigured: () => true,
    login: async () => 'mock-session-token',
    call: async <T>(object: string, method: string): Promise<T> => {
      // 1. Router network interface topology dump
      if (object === 'network.interface' && method === 'dump') {
        return {
          interface: [
            {
              interface: 'lan',
              device: 'br-lan',
              l3_device: 'br-lan',
              'ipv4-address': [{ address: '192.168.50.1', mask: 24 }],
            },
            {
              interface: 'loopback',
              device: 'lo',
              l3_device: 'lo',
              'ipv4-address': [{ address: '127.0.0.1', mask: 8 }],
            },
            {
              interface: 'wan',
              device: 'eth1',
              l3_device: 'eth1',
              'ipv4-address': [{ address: '192.168.122.132', mask: 24 }],
              route: [{ target: '0.0.0.0', mask: 0, nexthop: '192.168.122.1' }],
              data: { dhcpserver: '192.168.122.1' },
            },
          ],
        } as unknown as T;
      }

      // 2. OpenWrt hardware network devices
      if (object === 'luci-rpc' && method === 'getNetworkDevices') {
        return {
          'br-lan': { mac: '52:54:00:CF:15:77', ipaddrs: [{ address: '192.168.50.1' }] },
          'eth1': { mac: '52:54:00:E3:BE:C2', ipaddrs: [{ address: '192.168.122.132' }] },
        } as unknown as T;
      }

      // 3. DHCP Leases
      if (object === 'luci-rpc' && method === 'getDHCPLeases') {
        return {
          dhcp_leases: [
            // Real client: active DHCP lease
            {
              macaddr: 'aa:bb:cc:dd:ee:ff', // lowercase format
              ipaddr: '192.168.50.10',
              hostname: 'real-phone',
              expires: 43200,
            },
            // Disconnected client: expired/inactive DHCP lease
            {
              macaddr: '11:22:33:44:55:66',
              ipaddr: '192.168.50.20',
              hostname: 'old-laptop',
              expires: 0,
            },
            // Infrastructure host (should be filtered out even if present in DHCP)
            {
              macaddr: '52:54:00:5B:2E:C1',
              ipaddr: '192.168.50.254',
              hostname: 'ubuntu-host',
              expires: 43200,
            },
          ],
        } as unknown as T;
      }

      // 4. Host Hints
      if (object === 'luci-rpc' && method === 'getHostHints') {
        return {
          // Real client: dashed format for deduplication testing
          'AA-BB-CC-DD-EE-FF': {
            ipaddrs: ['192.168.50.10'],
            name: 'real-phone',
          },
          // Router itself
          '52:54:00:CF:15:77': {
            ipaddrs: ['192.168.50.1'],
            name: 'OpenWrt.lan',
          },
          // Host gateway
          '52:54:00:5B:2E:C1': {
            ipaddrs: ['192.168.50.254'],
            name: 'ubuntu-host',
          },
          // Libvirt network gateway
          '52:54:00:42:E6:9C': {
            ipaddrs: ['192.168.122.1'],
            name: 'libvirt-gw',
          },
        } as unknown as T;
      }

      // 5. Kernel IPv4 Neighbour Table (/sbin/ip -4 neigh show)
      if (object === 'file' && method === 'exec') {
        return {
          code: 0,
          stdout:
            // Real client: REACHABLE on br-lan
            '192.168.50.10 dev br-lan lladdr aa-bb-cc-dd-ee-ff ref 1 used 0/0/0 probes 1 REACHABLE\n' +
            // Disconnected client: FAILED on br-lan
            '192.168.50.20 dev br-lan lladdr 11:22:33:44:55:66 ref 1 used 0/0/0 probes 1 FAILED\n' +
            // Host virbr1 on br-lan: REACHABLE (MUST be excluded)
            '192.168.50.254 dev br-lan lladdr 52:54:00:5b:2e:c1 ref 1 used 0/0/0 probes 1 REACHABLE\n' +
            // Libvirt network on eth1: STALE (MUST be excluded)
            '192.168.122.1 dev eth1 lladdr 52:54:00:42:e6:9c used 0/0/0 probes 1 STALE\n' +
            // Router itself: (MUST be excluded)
            '192.168.50.1 dev br-lan lladdr 52:54:00:cf:15:77 ref 1 used 0/0/0 probes 1 REACHABLE\n',
        } as unknown as T;
      }

      return {} as unknown as T;
    },
  } as unknown as UbusClient;

  const service = new DevicesService(mockUbus);
  const devices = await service.getConnectedDevices();

  // Test 1: Router itself does not appear
  console.log('Running Test 1: Router itself does not appear...');
  const routerAppears = devices.some(
    (d) =>
      d.ip === '192.168.50.1' ||
      d.ip === '127.0.0.1' ||
      d.mac === '52:54:00:CF:15:77' ||
      d.hostname === 'OpenWrt.lan'
  );
  assert.equal(routerAppears, false, 'Test 1 Failed: Router itself must be filtered out');
  console.log('✅ Test 1 Passed: Router is excluded');

  // Test 2: Host 192.168.50.254 does not appear as a client
  console.log('Running Test 2: Host 192.168.50.254 does not appear as a client...');
  const hostAppears = devices.some(
    (d) => d.ip === '192.168.50.254' || d.mac === '52:54:00:5B:2E:C1'
  );
  assert.equal(hostAppears, false, 'Test 2 Failed: Host (192.168.50.254) must be filtered out');
  console.log('✅ Test 2 Passed: Host 192.168.50.254 is excluded');

  // Test 3: Libvirt network 192.168.122.1 does not appear as a client
  console.log('Running Test 3: Libvirt network 192.168.122.1 does not appear as a client...');
  const libvirtAppears = devices.some(
    (d) => d.ip === '192.168.122.1' || d.mac === '52:54:00:42:E6:9C'
  );
  assert.equal(libvirtAppears, false, 'Test 3 Failed: Libvirt network (192.168.122.1) must be filtered out');
  console.log('✅ Test 3 Passed: Libvirt network 192.168.122.1 is excluded');

  // Test 4: Real client appears (MAC: AA:BB:CC:DD:EE:FF, IP: 192.168.50.10)
  console.log('Running Test 4: Real client appears...');
  const realClient = devices.find((d) => d.mac === 'AA:BB:CC:DD:EE:FF');
  assert.ok(realClient, 'Test 4 Failed: Real client must be discovered');
  assert.equal(realClient.ip, '192.168.50.10');
  assert.equal(realClient.hostname, 'real-phone');
  assert.equal(realClient.interface, 'br-lan');
  console.log('✅ Test 4 Passed: Real client is discovered');

  // Test 5: Same MAC from multiple sources produces exactly ONE device (deduplication)
  console.log('Running Test 5: Deduplication...');
  const duplicateMatches = devices.filter((d) => d.mac === 'AA:BB:CC:DD:EE:FF');
  assert.equal(duplicateMatches.length, 1, 'Test 5 Failed: Device must appear exactly once');
  console.log('✅ Test 5 Passed: Multi-source deduplication works');

  // Test 6: MAC normalization works
  console.log('Running Test 6: MAC normalization...');
  assert.equal(normalizeMac('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMac('AA-BB-CC-DD-EE-FF'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(realClient.id, 'AA:BB:CC:DD:EE:FF', 'Device ID must be the normalized MAC');
  assert.equal(realClient.mac, 'AA:BB:CC:DD:EE:FF', 'Device MAC must be normalized to uppercase');
  console.log('✅ Test 6 Passed: MAC normalization is consistent');

  // Test 7: connected=true works
  console.log('Running Test 7: connected status calculation & filter...');
  assert.equal(realClient.connected, true, 'Reachable neighbour with active lease must be connected');

  const disconnectedClient = devices.find((d) => d.mac === '11:22:33:44:55:66');
  assert.ok(disconnectedClient);
  assert.equal(disconnectedClient.connected, false, 'Failed neighbour with expired lease must be disconnected');

  const onlineOnly = await service.getConnectedDevices({ connected: true });
  assert.equal(onlineOnly.length, 1);
  assert.equal(onlineOnly[0]?.mac, 'AA:BB:CC:DD:EE:FF');

  const offlineOnly = await service.getConnectedDevices({ connected: false });
  assert.equal(offlineOnly.length, 1);
  assert.equal(offlineOnly[0]?.mac, '11:22:33:44:55:66');
  console.log('✅ Test 7 Passed: connected=true and connected=false work accurately');

  // Test 8: interface=br-lan works
  console.log('Running Test 8: interface filter...');
  const brLanFiltered = await service.getConnectedDevices({ interface: 'br-lan' });
  assert.equal(brLanFiltered.length, 2);
  assert.ok(brLanFiltered.every((d) => d.interface === 'br-lan'));

  const nonExistentIface = await service.getConnectedDevices({ interface: 'wlan99' });
  assert.equal(nonExistentIface.length, 0);
  console.log('✅ Test 8 Passed: interface=br-lan filtering works');

  // Test 9: search works
  console.log('Running Test 9: search filter...');
  const searchByName = await service.getConnectedDevices({ search: 'real-phone' });
  assert.equal(searchByName.length, 1);
  assert.equal(searchByName[0]?.mac, 'AA:BB:CC:DD:EE:FF');

  const searchByIp = await service.getConnectedDevices({ search: '192.168.50.10' });
  assert.equal(searchByIp.length, 1);
  assert.equal(searchByIp[0]?.mac, 'AA:BB:CC:DD:EE:FF');

  const searchByMac = await service.getConnectedDevices({ search: 'dd:ee' });
  assert.equal(searchByMac.length, 1);
  assert.equal(searchByMac[0]?.mac, 'AA:BB:CC:DD:EE:FF');

  const searchNotFound = await service.getConnectedDevices({ search: 'nonexistent-query' });
  assert.equal(searchNotFound.length, 0);
  console.log('✅ Test 9 Passed: search filter works');

  console.log('\n🎉 ALL 9 TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

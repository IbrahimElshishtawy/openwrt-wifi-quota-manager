import assert from 'node:assert/strict';
import { DeviceService } from '../src/modules/devices/device.service.js';
async function runTests() {
    console.log('🧪 Starting DeviceService tests...');
    // Mock UbusClient
    const mockUbus = {
        isConfigured: () => true,
        getDhcpLeases: async () => [
            {
                mac: '52:54:00:CF:15:77',
                ip: '192.168.50.150',
                hostname: 'test-client',
                expires: 1727028123,
            },
            {
                mac: '52:54:00:11:22:33',
                ip: '192.168.50.100',
                hostname: '*',
                expires: 1727028199,
            },
        ],
        getArpTable: async () => [
            {
                ip: '192.168.50.150',
                mac: '52:54:00:CF:15:77',
                device: 'br-lan',
                flags: '0x2',
            },
            {
                ip: '192.168.50.200',
                mac: 'AA:BB:CC:DD:EE:FF',
                device: 'br-lan',
                flags: '0x2',
            },
        ],
    };
    const service = new DeviceService(mockUbus);
    const devices = await service.getConnectedDevices();
    assert.equal(devices.length, 3, 'Should discover 3 distinct devices');
    // Verify DHCP lease device
    const dev1 = devices.find((d) => d.mac === '52:54:00:CF:15:77');
    assert.ok(dev1, 'Should find test-client device');
    assert.equal(dev1.hostname, 'test-client');
    assert.equal(dev1.ip, '192.168.50.150');
    assert.equal(dev1.status, 'online');
    assert.equal(dev1.interface, 'br-lan');
    // Verify hostname normalization for '*'
    const dev2 = devices.find((d) => d.mac === '52:54:00:11:22:33');
    assert.ok(dev2);
    assert.equal(dev2.hostname, 'Unknown', 'Should normalize * to Unknown');
    // Verify static ARP device
    const dev3 = devices.find((d) => d.mac === 'AA:BB:CC:DD:EE:FF');
    assert.ok(dev3, 'Should discover static device from ARP table');
    assert.equal(dev3.ip, '192.168.50.200');
    assert.equal(dev3.status, 'online');
    // Verify search filtering
    const filtered = await service.getConnectedDevices({ search: 'test-client' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.mac, '52:54:00:CF:15:77');
    console.log('✅ All DeviceService tests passed successfully!');
}
runTests().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
//# sourceMappingURL=device.service.test.js.map
import assert from 'node:assert/strict';
import {
  UsageService,
  UsageFetchError,
  normalizeMac,
} from '../src/modules/usage/UsageService.js';
import type { ISshClient, SshExecutionResult } from '../src/infrastructure/openwrt/SshClient.js';
import { OpenWrtConnectionError } from '../src/infrastructure/openwrt/UbusClient.js';

async function runTests() {
  console.log('🧪 Starting UsageService Comprehensive Tests...');

  const validSampleOutput = JSON.stringify({
    columns: [
      'family', 'proto', 'port', 'mac', 'ip',
      'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
    ],
    data: [
      [4, 'ICMP', 0, '52:54:00:ce:1c:be', '192.168.50.50', 6, 1008, 12, 1344, 16, 'ICMP'],
    ],
  });

  // Test 1: Parsing valid nlbwmon JSON
  console.log('Running Test 1: Parsing valid nlbwmon JSON...');
  {
    const service = new UsageService();
    const result = service.parseAndAggregateNlbwOutput(validSampleOutput);

    assert.equal(result.length, 1, 'Expected exactly 1 device');
    const device = result[0]!;
    assert.equal(device.mac, '52:54:00:CE:1C:BE', 'MAC must be normalized uppercase');
    assert.equal(device.ip, '192.168.50.50', 'IP must match');
    assert.equal(device.downloadBytes, 1008, 'downloadBytes must match rx_bytes');
    assert.equal(device.uploadBytes, 1344, 'uploadBytes must match tx_bytes');
    assert.equal(device.totalBytes, 2352, 'totalBytes must be download + upload');
    console.log('✅ Test 1 Passed: Valid nlbwmon JSON parsed successfully');
  }

  // Test 2: Aggregating multiple rows for one device
  console.log('Running Test 2: Aggregating multiple rows for one device...');
  {
    const multiRowOutput = JSON.stringify({
      columns: [
        'family', 'proto', 'port', 'mac', 'ip',
        'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
      ],
      data: [
        // Flow 1: ICMP
        [4, 'ICMP', 0, '52:54:00:ce:1c:be', '192.168.50.50', 6, 1008, 12, 1344, 16, 'ICMP'],
        // Flow 2: UDP DNS
        [4, 'UDP', 53, '52:54:00:ce:1c:be', '192.168.50.50', 6, 420, 4, 450, 8, 'DNS'],
        // Flow 3: TCP HTTPS
        [4, 'TCP', 443, '52:54:00:CE:1C:BE', '192.168.50.50', 20, 2000, 30, 3000, 40, 'HTTPS'],
        // Flow for second device
        [4, 'UDP', 53, 'aa:bb:cc:dd:ee:01', '192.168.50.60', 1, 100, 2, 200, 3, 'DNS'],
      ],
    });

    const service = new UsageService();
    const result = service.parseAndAggregateNlbwOutput(multiRowOutput);

    assert.equal(result.length, 2, 'Expected 2 devices');

    const dev1 = result.find((d) => d.mac === '52:54:00:CE:1C:BE');
    assert.ok(dev1, 'Device 1 must exist');
    assert.equal(dev1.ip, '192.168.50.50');
    assert.equal(dev1.downloadBytes, 1008 + 420 + 2000); // 3428
    assert.equal(dev1.uploadBytes, 1344 + 450 + 3000);   // 4794
    assert.equal(dev1.totalBytes, 3428 + 4794);          // 8222

    const dev2 = result.find((d) => d.mac === 'AA:BB:CC:DD:EE:01');
    assert.ok(dev2, 'Device 2 must exist');
    assert.equal(dev2.downloadBytes, 100);
    assert.equal(dev2.uploadBytes, 200);
    assert.equal(dev2.totalBytes, 300);

    console.log('✅ Test 2 Passed: Multiple rows aggregated accurately per device');
  }

  // Test 3: Ignoring invalid rows
  console.log('Running Test 3: Ignoring invalid rows...');
  {
    const invalidRowsOutput = JSON.stringify({
      columns: [
        'family', 'proto', 'port', 'mac', 'ip',
        'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
      ],
      data: [
        // Valid row
        [4, 'TCP', 80, '11:22:33:44:55:66', '192.168.50.10', 1, 500, 5, 600, 6, 'HTTP'],
        // Invalid: missing MAC (null)
        [4, 'TCP', 80, null, '192.168.50.11', 1, 100, 1, 100, 1, null],
        // Invalid: empty MAC
        [4, 'TCP', 80, '', '192.168.50.12', 1, 100, 1, 100, 1, null],
        // Invalid: malformed MAC
        [4, 'TCP', 80, 'invalid-mac', '192.168.50.13', 1, 100, 1, 100, 1, null],
        // Invalid: missing IP (null)
        [4, 'TCP', 80, '22:33:44:55:66:77', null, 1, 100, 1, 100, 1, null],
        // Invalid: empty IP
        [4, 'TCP', 80, '22:33:44:55:66:77', '', 1, 100, 1, 100, 1, null],
        // Invalid: non-numeric bytes
        [4, 'TCP', 80, '33:44:55:66:77:88', '192.168.50.15', 1, 'bad-number', 1, 100, 1, null],
        // Invalid: negative bytes
        [4, 'TCP', 80, '44:55:66:77:88:99', '192.168.50.16', 1, -50, 1, 100, 1, null],
        // Invalid: row is not an array
        'invalid-row-string' as unknown as Array<string | number>,
      ],
    });

    const service = new UsageService();
    const result = service.parseAndAggregateNlbwOutput(invalidRowsOutput);

    assert.equal(result.length, 1, 'Only the single valid row should be accepted');
    assert.equal(result[0]?.mac, '11:22:33:44:55:66');
    assert.equal(result[0]?.downloadBytes, 500);
    assert.equal(result[0]?.uploadBytes, 600);
    console.log('✅ Test 3 Passed: Invalid rows safely ignored');
  }

  // Test 4: Empty usage result
  console.log('Running Test 4: Empty usage result...');
  {
    const service = new UsageService();

    // Empty data array
    const emptyDataOutput = JSON.stringify({
      columns: ['family', 'proto', 'port', 'mac', 'ip', 'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'],
      data: [],
    });
    assert.deepEqual(service.parseAndAggregateNlbwOutput(emptyDataOutput), []);

    // Empty string
    assert.deepEqual(service.parseAndAggregateNlbwOutput(''), []);
    assert.deepEqual(service.parseAndAggregateNlbwOutput('   \n  '), []);

    // Empty object
    assert.deepEqual(service.parseAndAggregateNlbwOutput('{}'), []);
    console.log('✅ Test 4 Passed: Empty usage inputs handled gracefully');
  }

  // Test 5: Command failure
  console.log('Running Test 5: Command failure handling...');
  {
    const failingMockSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async (_command: string): Promise<SshExecutionResult> => {
        throw new OpenWrtConnectionError('Connection refused to OpenWrt router:22');
      },
    };

    const service = new UsageService(failingMockSsh);

    await assert.rejects(
      async () => service.getDeviceUsage(),
      (err: unknown) => {
        assert.ok(err instanceof OpenWrtConnectionError);
        assert.equal(err.statusCode, 502);
        return true;
      },
      'Should throw OpenWrtConnectionError with status 502'
    );
    console.log('✅ Test 5 Passed: Router command failure handled properly');
  }

  // Test 6: Invalid JSON handling
  console.log('Running Test 6: Invalid JSON handling...');
  {
    const service = new UsageService();
    assert.throws(
      () => service.parseAndAggregateNlbwOutput('This is not json: error 500'),
      (err: unknown) => {
        assert.ok(err instanceof UsageFetchError);
        assert.equal(err.statusCode, 502);
        return true;
      }
    );
    console.log('✅ Test 6 Passed: Malformed JSON throws UsageFetchError with 502');
  }

  // Test 7: Integration with mock SshClient
  console.log('Running Test 7: Integration with mock SshClient...');
  {
    const mockSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async (cmd: string): Promise<SshExecutionResult> => {
        assert.equal(cmd, 'nlbw -c json');
        return {
          stdout: validSampleOutput,
          stderr: '',
          exitCode: 0,
        };
      },
    };

    const service = new UsageService(mockSsh);
    const result = await service.getDeviceUsage();

    assert.equal(result.length, 1);
    assert.equal(result[0]?.mac, '52:54:00:CE:1C:BE');
    console.log('✅ Test 7 Passed: UsageService.getDeviceUsage() returns expected data');
  }

  // Test 8: MAC address normalizer
  console.log('Running Test 8: normalizeMac...');
  {
    assert.equal(normalizeMac('52:54:00:ce:1c:be'), '52:54:00:CE:1C:BE');
    assert.equal(normalizeMac('52-54-00-ce-1c-be'), '52:54:00:CE:1C:BE');
    assert.throws(() => normalizeMac('not-valid'));
    console.log('✅ Test 8 Passed: normalizeMac works consistently');
  }

  // Test 9: Real LAN client retained and infrastructure IP 192.168.122.132 excluded
  console.log('Running Test 9: Real LAN client retained & infrastructure 192.168.122.132 excluded...');
  {
    const mixedTelemetery = JSON.stringify({
      columns: [
        'family', 'proto', 'port', 'mac', 'ip',
        'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
      ],
      data: [
        // Real client
        [4, 'TCP', 443, '52:54:00:ce:1c:be', '192.168.50.50', 10, 1428, 15, 1794, 20, 'HTTPS'],
        // Infrastructure / libvirt WAN address
        [4, 'TCP', 443, '52:54:00:e3:be:c2', '192.168.122.132', 50, 2131296, 500, 127088, 300, 'HTTPS'],
      ],
    });

    const mockSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async () => ({
        stdout: mixedTelemetery,
        stderr: '',
        exitCode: 0,
      }),
    };

    const service = new UsageService(mockSsh);
    const result = await service.getDeviceUsage();

    assert.equal(result.length, 1, 'Expected exactly 1 client device after filtering');
    assert.equal(result[0]?.mac, '52:54:00:CE:1C:BE', 'Real client must be retained');
    assert.equal(result[0]?.ip, '192.168.50.50');
    assert.equal(result[0]?.downloadBytes, 1428);
    assert.equal(result[0]?.uploadBytes, 1794);
    assert.equal(result[0]?.totalBytes, 3222);

    const hasInfraDevice = result.some((d) => d.ip === '192.168.122.132' || d.mac === '52:54:00:E3:BE:C2');
    assert.equal(hasInfraDevice, false, 'Infrastructure 192.168.122.132 / 52:54:00:E3:BE:C2 must be excluded');

    console.log('✅ Test 9 Passed: Infrastructure 192.168.122.132 excluded, real LAN client retained');
  }

  // Test 10: Router self, Host bridge, and Libvirt gateway excluded
  console.log('Running Test 10: Router self, host bridge, and libvirt gateway excluded...');
  {
    const infraTelemetry = JSON.stringify({
      columns: [
        'family', 'proto', 'port', 'mac', 'ip',
        'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
      ],
      data: [
        // Router self
        [4, 'TCP', 80, '52:54:00:cf:15:77', '192.168.50.1', 5, 500, 5, 500, 5, 'HTTP'],
        // Host bridge
        [4, 'TCP', 22, '52:54:00:5b:2e:c1', '192.168.50.254', 10, 1000, 10, 1000, 10, 'SSH'],
        // Libvirt host gateway
        [4, 'UDP', 53, '52:54:00:42:e6:9c', '192.168.122.1', 2, 200, 2, 200, 2, 'DNS'],
        // Real client
        [4, 'TCP', 80, '52:54:00:ce:1c:be', '192.168.50.50', 1, 100, 1, 100, 1, 'HTTP'],
      ],
    });

    const mockSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async () => ({
        stdout: infraTelemetry,
        stderr: '',
        exitCode: 0,
      }),
    };

    const service = new UsageService(mockSsh);
    const result = await service.getDeviceUsage();

    assert.equal(result.length, 1, 'Only real LAN client should be present');
    assert.equal(result[0]?.mac, '52:54:00:CE:1C:BE');
    assert.equal(result[0]?.ip, '192.168.50.50');

    assert.equal(result.some((d) => d.ip === '192.168.50.1'), false, 'Router 192.168.50.1 must be excluded');
    assert.equal(result.some((d) => d.ip === '192.168.50.254'), false, 'Host 192.168.50.254 must be excluded');
    assert.equal(result.some((d) => d.ip === '192.168.122.1'), false, 'Libvirt 192.168.122.1 must be excluded');

    console.log('✅ Test 10 Passed: Router self, host bridge, and libvirt gateway excluded');
  }

  // Test 11: External / non-LAN IP addresses excluded
  console.log('Running Test 11: Non-LAN / external addresses excluded...');
  {
    const externalTelemetry = JSON.stringify({
      columns: [
        'family', 'proto', 'port', 'mac', 'ip',
        'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
      ],
      data: [
        // External DNS IP (should not be treated as user device)
        [4, 'UDP', 53, 'aa:bb:cc:11:22:33', '8.8.8.8', 1, 100, 1, 100, 1, 'DNS'],
        // Real client
        [4, 'TCP', 443, '52:54:00:ce:1c:be', '192.168.50.50', 5, 500, 5, 500, 5, 'HTTPS'],
      ],
    });

    const mockSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async () => ({
        stdout: externalTelemetry,
        stderr: '',
        exitCode: 0,
      }),
    };

    const service = new UsageService(mockSsh);
    const result = await service.getDeviceUsage();

    assert.equal(result.length, 1);
    assert.equal(result[0]?.mac, '52:54:00:CE:1C:BE');
    assert.equal(result.some((d) => d.ip === '8.8.8.8'), false, 'External IP 8.8.8.8 must be excluded');
    console.log('✅ Test 11 Passed: External IP excluded, real LAN client retained');
  }

  // Test 12: Multi-row aggregation + infrastructure filtering end-to-end
  console.log('Running Test 12: Multi-row aggregation + infrastructure filtering end-to-end...');
  {
    const multiRowMixed = JSON.stringify({
      columns: [
        'family', 'proto', 'port', 'mac', 'ip',
        'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts', 'layer7'
      ],
      data: [
        // Client 1 Flow 1
        [4, 'ICMP', 0, '52:54:00:ce:1c:be', '192.168.50.50', 6, 1000, 10, 1000, 10, 'ICMP'],
        // Client 1 Flow 2
        [4, 'TCP', 443, '52:54:00:ce:1c:be', '192.168.50.50', 10, 2000, 20, 3000, 30, 'HTTPS'],
        // Client 2 (LAN client)
        [4, 'UDP', 53, 'aa:bb:cc:dd:ee:01', '192.168.50.60', 4, 300, 4, 400, 4, 'DNS'],
        // Infrastructure WAN (libvirt)
        [4, 'TCP', 443, '52:54:00:e3:be:c2', '192.168.122.132', 100, 50000, 100, 50000, 100, 'HTTPS'],
        // Router self
        [4, 'TCP', 80, '52:54:00:cf:15:77', '192.168.50.1', 1, 100, 1, 100, 1, 'HTTP'],
      ],
    });

    const mockSsh: ISshClient = {
      isConfigured: () => true,
      executeCommand: async () => ({
        stdout: multiRowMixed,
        stderr: '',
        exitCode: 0,
      }),
    };

    const service = new UsageService(mockSsh);
    const result = await service.getDeviceUsage();

    assert.equal(result.length, 2, 'Expected 2 real client devices');

    const dev1 = result.find((d) => d.mac === '52:54:00:CE:1C:BE');
    assert.ok(dev1);
    assert.equal(dev1.ip, '192.168.50.50');
    assert.equal(dev1.downloadBytes, 3000);
    assert.equal(dev1.uploadBytes, 4000);
    assert.equal(dev1.totalBytes, 7000);

    const dev2 = result.find((d) => d.mac === 'AA:BB:CC:DD:EE:01');
    assert.ok(dev2);
    assert.equal(dev2.ip, '192.168.50.60');
    assert.equal(dev2.downloadBytes, 300);
    assert.equal(dev2.uploadBytes, 400);
    assert.equal(dev2.totalBytes, 700);

    console.log('✅ Test 12 Passed: Multi-row aggregation + infrastructure filtering verified');
  }

  console.log('\n🎉 ALL UsageService TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runTests().catch((err) => {
  console.error('❌ UsageService test failed:', err);
  process.exit(1);
});

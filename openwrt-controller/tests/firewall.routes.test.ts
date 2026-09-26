import assert from 'node:assert/strict';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { firewallRoutes } from '../src/modules/firewall/firewall.routes.js';
import { FirewallService } from '../src/modules/firewall/FirewallService.js';
import { NftablesClient } from '../src/modules/firewall/NftablesClient.js';
import {
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
} from '../src/modules/firewall/types.js';
import type { ISshClient, SshExecutionResult } from '../src/infrastructure/openwrt/SshClient.js';
import type { DevicesService } from '../src/modules/devices/DevicesService.js';
import type { Device, InfrastructureMetadata } from '../src/modules/devices/types.js';

function createMockDependencies() {
  const blockedSet = new Set<string>();
  let fail = false;

  const infra: InfrastructureMetadata = {
    excludedIps: new Set(['192.168.50.1', '192.168.50.254']),
    excludedMacs: new Set(['52:54:00:CF:15:77', '52:54:00:5B:2E:C1']),
    excludedHostnames: new Set(['openwrt']),
    wanDevices: new Set(['eth1']),
    lanSubnets: [{ network: '192.168.50.0', mask: 24, cidr: '192.168.50.0/24' }],
  };

  const realDevices: Device[] = [
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
    {
      id: '52:54:00:AA:BB:CC',
      mac: '52:54:00:AA:BB:CC',
      ip: '192.168.50.51',
      hostname: 'second-client',
      interface: 'br-lan',
      connected: true,
      rxBytes: 0,
      txBytes: 0,
    },
  ];

  const devicesServiceMock = {
    detectInfrastructure: async () => infra,
    getConnectedDevices: async () => realDevices,
    isRealLanClient: (
      candidate: { mac: string; ip: string | null; hostname?: string | null; interface?: string | null },
      infraMeta: InfrastructureMetadata
    ) => {
      if (infraMeta.excludedMacs.has(candidate.mac)) return false;
      if (candidate.mac === '52:54:00:99:99:99') return false; // non-LAN client
      return true;
    },
  } as unknown as DevicesService;

  const mockSsh: ISshClient = {
    isConfigured: () => true,
    executeCommand: async (cmd: string): Promise<SshExecutionResult> => {
      if (fail) {
        throw new Error('Router unreachable');
      }

      if (cmd.includes('nft add element')) {
        const match = cmd.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
        if (match && match[1]) {
          blockedSet.add(match[1].toUpperCase());
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (cmd.includes('nft delete element')) {
        const match = cmd.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
        if (match && match[1]) {
          blockedSet.delete(match[1].toUpperCase());
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (cmd.includes('nft get element')) {
        const match = cmd.match(/([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/);
        if (match && match[1] && blockedSet.has(match[1].toUpperCase())) {
          return { stdout: 'element exists', stderr: '', exitCode: 0 };
        }
        throw new Error('Element not found');
      }

      if (cmd.includes('nft -j list set') || cmd.includes('nft list set')) {
        const json = {
          nftables: [
            {
              set: {
                family: 'inet',
                name: 'blocked_macs',
                table: 'quota_enforcement',
                elem: Array.from(blockedSet),
              },
            },
          ],
        };
        return { stdout: JSON.stringify(json), stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };

  const nftClient = new NftablesClient(mockSsh);
  const service = new FirewallService(nftClient, devicesServiceMock);

  return { service, setFail: (v: boolean) => { fail = v; }, blockedSet };
}

function buildTestApp(service: FirewallService) {
  const app = Fastify();

  app.setErrorHandler((error: any, _request: FastifyRequest, reply: FastifyReply) => {
    if (
      error instanceof InvalidMacAddressError ||
      error instanceof InfrastructureDeviceError ||
      error instanceof NonClientDeviceError
    ) {
      return reply.status(400).send({
        statusCode: 400,
        error: error.name,
        code: error.code,
        message: error.message,
        success: false,
      });
    }

    if (error instanceof FirewallExecutionError) {
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

  return app;
}

async function runFirewallRouteTests() {
  console.log('🧪 Starting FirewallRoutes HTTP Integration tests...');

  const { service, setFail } = createMockDependencies();
  const app = buildTestApp(service);
  await app.register(firewallRoutes, { service });

  // 1. Test POST /api/blocks/:mac (Primary RESTful block endpoint)
  console.log('Testing POST /api/blocks/:mac...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks/52:54:00:CE:1C:BE',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.mac, '52:54:00:CE:1C:BE');
    assert.equal(body.isBlocked, true);
    console.log('✅ POST /api/blocks/:mac succeeded with 200');
  }

  // 2. Test GET /api/blocks/:mac (Check block status)
  console.log('Testing GET /api/blocks/:mac...');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/blocks/52:54:00:ce:1c:be',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.mac, '52:54:00:CE:1C:BE');
    assert.equal(body.isBlocked, true);
    console.log('✅ GET /api/blocks/:mac verified blocked state');
  }

  // 3. Test GET /api/blocks (List all blocked devices)
  console.log('Testing GET /api/blocks...');
  {
    const res = await app.inject({
      method: 'GET',
      url: '/api/blocks',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.count, 1);
    assert.equal(body.data[0], '52:54:00:CE:1C:BE');
    console.log('✅ GET /api/blocks returned blocked devices list');
  }

  // 4. Test DELETE /api/blocks/:mac (Unblock device)
  console.log('Testing DELETE /api/blocks/:mac...');
  {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/blocks/52:54:00:CE:1C:BE',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.mac, '52:54:00:CE:1C:BE');
    assert.equal(body.isBlocked, false);

    // Verify GET now returns false
    const checkRes = await app.inject({
      method: 'GET',
      url: '/api/blocks/52:54:00:CE:1C:BE',
    });
    assert.equal(checkRes.json().isBlocked, false);
    console.log('✅ DELETE /api/blocks/:mac cleanly unblocked device');
  }

  // 5. Test POST /api/blocks with JSON body
  console.log('Testing POST /api/blocks with JSON payload...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks',
      payload: { mac: '52:54:00:AA:BB:CC' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().isBlocked, true);
    console.log('✅ POST /api/blocks with body succeeded');
  }

  // 6. Test POST with invalid MAC -> 400 Bad Request
  console.log('Testing POST with invalid MAC...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks/not-a-mac',
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'INVALID_MAC_ADDRESS');
    console.log('✅ Invalid MAC rejected with 400 Bad Request');
  }

  // 7. Test POST with router infrastructure MAC -> 400 Bad Request
  console.log('Testing POST with infrastructure MAC...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks/52:54:00:CF:15:77',
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'INFRASTRUCTURE_DEVICE_PROTECTED');
    console.log('✅ Router MAC protected with 400 Bad Request');
  }

  // 8. Test POST with non-LAN client MAC -> 400 Bad Request
  console.log('Testing POST with non-LAN client MAC...');
  {
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks/52:54:00:99:99:99',
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'NON_CLIENT_DEVICE');
    console.log('✅ Non-LAN client MAC rejected with 400 Bad Request');
  }

  // 9. Test Compatibility endpoints (/block, /unblock, /blocked)
  console.log('Testing compatibility endpoints...');
  {
    const blockRes = await app.inject({
      method: 'POST',
      url: '/block',
      payload: { mac: '52:54:00:CE:1C:BE' },
    });
    assert.equal(blockRes.statusCode, 200);
    assert.equal(blockRes.json().isBlocked, true);

    const blockedListRes = await app.inject({
      method: 'GET',
      url: '/blocked',
    });
    assert.equal(blockedListRes.statusCode, 200);
    assert.equal(blockedListRes.json().data.includes('52:54:00:CE:1C:BE'), true);

    const unblockRes = await app.inject({
      method: 'POST',
      url: '/unblock',
      payload: { mac: '52:54:00:CE:1C:BE' },
    });
    assert.equal(unblockRes.statusCode, 200);
    assert.equal(unblockRes.json().isBlocked, false);

    // Verify GET /api/firewall/blocked
    const apiFwRes = await app.inject({
      method: 'GET',
      url: '/api/firewall/blocked',
    });
    assert.equal(apiFwRes.statusCode, 200);
    assert.equal(apiFwRes.json().success, true);
    assert.equal(Array.isArray(apiFwRes.json().data), true);
    console.log('✅ Compatibility endpoints /block, /unblock, /blocked, and /api/firewall/blocked passed');
  }

  // 10. Test Router Failure -> 502 Bad Gateway
  console.log('Testing router failure error mapping (502)...');
  {
    setFail(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/blocks/52:54:00:CE:1C:BE',
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.json().code, 'FIREWALL_EXECUTION_ERROR');
    console.log('✅ Router connection error mapped to 502 Bad Gateway');
    setFail(false);
  }

  console.log('\n🎉 ALL FirewallRoutes HTTP TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runFirewallRouteTests().catch((err) => {
  console.error('❌ FirewallRoutes test failed:', err);
  process.exit(1);
});

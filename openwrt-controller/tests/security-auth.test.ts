import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { safeTokenCompare } from '../src/infrastructure/security/auth.js';

async function runSecurityAuthTests() {
  console.log('🧪 Starting Security Authentication & Authorization Tests...');

  const TEST_TOKEN = 'secret-admin-test-token-32-chars';

  // Test 1: Constant-time token comparison
  {
    console.log('Running Test 1: Constant-time safe token comparison...');
    assert.equal(safeTokenCompare(TEST_TOKEN, TEST_TOKEN), true);
    assert.equal(safeTokenCompare('wrong-token', TEST_TOKEN), false);
    assert.equal(safeTokenCompare('', TEST_TOKEN), false);
    assert.equal(safeTokenCompare(TEST_TOKEN, ''), false);
    assert.equal(safeTokenCompare('short', TEST_TOKEN), false);
    console.log('✅ Test 1 Passed: safeTokenCompare verified');
  }

  // Test 2: Unauthenticated WRITE request rejected with 401
  {
    console.log('Running Test 2: State-changing WRITE without token returns 401...');
    const app = await buildApp({
      authEnabled: true,
      apiToken: TEST_TOKEN,
      rateLimitEnabled: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/block',
      payload: { mac: '52:54:00:11:22:33' },
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.ok(body.error.requestId);
    console.log('✅ Test 2 Passed: 401 on unauthenticated WRITE');
  }

  // Test 3: Invalid token rejected with 401
  {
    console.log('Running Test 3: WRITE with invalid Bearer token returns 401...');
    const app = await buildApp({
      authEnabled: true,
      apiToken: TEST_TOKEN,
      rateLimitEnabled: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/block',
      headers: {
        authorization: 'Bearer invalid-token-value',
      },
      payload: { mac: '52:54:00:11:22:33' },
    });

    assert.equal(res.statusCode, 401);
    const body = res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
    console.log('✅ Test 3 Passed: 401 on invalid Bearer token');
  }

  // Test 4: Valid Bearer token accepted
  {
    console.log('Running Test 4: Valid Bearer token authenticated successfully...');
    const app = await buildApp({
      authEnabled: true,
      apiToken: TEST_TOKEN,
      rateLimitEnabled: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/block',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
      },
      payload: { mac: '52:54:00:11:22:33' },
    });

    // Device not recognized in mock environment returns 400 NonClientDeviceError, NOT 401 Unauthorized
    assert.notEqual(res.statusCode, 401);
    console.log('✅ Test 4 Passed: Bearer token accepted by auth hook');
  }

  // Test 5: x-api-key header accepted
  {
    console.log('Running Test 5: Valid x-api-key header accepted...');
    const app = await buildApp({
      authEnabled: true,
      apiToken: TEST_TOKEN,
      rateLimitEnabled: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/block',
      headers: {
        'x-api-key': TEST_TOKEN,
      },
      payload: { mac: '52:54:00:11:22:33' },
    });

    assert.notEqual(res.statusCode, 401);
    console.log('✅ Test 5 Passed: x-api-key header accepted by auth hook');
  }

  // Test 6: Health check endpoints accessible without token
  {
    console.log('Running Test 6: Public health check accessible without token...');
    const app = await buildApp({
      authEnabled: true,
      apiToken: TEST_TOKEN,
      rateLimitEnabled: false,
    });

    const resApiHealth = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    assert.equal(resApiHealth.statusCode, 200);

    const resHealth = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.equal(resHealth.statusCode, 200);
    console.log('✅ Test 6 Passed: Public health checks pass without auth token');
  }

  console.log('🎉 ALL Security Authentication Tests PASSED! 🎉\n');
}

void runSecurityAuthTests();

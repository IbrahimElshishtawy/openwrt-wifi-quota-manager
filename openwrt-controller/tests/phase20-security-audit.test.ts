import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { NftablesSafetyGuard } from '../src/modules/firewall/NftablesSafetyGuard.js';
import { SshClient } from '../src/infrastructure/openwrt/SshClient.js';

async function run() {
  console.log('🧪 Starting Stage 14: Comprehensive Security Validation & Hardening Audit...');

  const VALID_TOKEN = 'production-super-secure-token-12345678';
  const WRONG_TOKEN = 'wrong-invalid-attacker-token';

  // ============================================================================
  // Test 1: Authentication & protectReads for Read Endpoints
  // ============================================================================
  console.log('\n--- Scenario 14.1: Read Endpoints Protection (protectReads) ---');
  {
    const app = await buildApp({
      authEnabled: true,
      apiToken: VALID_TOKEN,
      protectReads: true,
    });

    const protectedReadUrls = [
      '/api/devices',
      '/api/usage',
      '/api/quotas',
    ];

    for (const url of protectedReadUrls) {
      // 1. Without token: must be rejected with 401
      const resUnauth = await app.inject({ method: 'GET', url });
      assert.equal(resUnauth.statusCode, 401, `GET ${url} must require auth when protectReads is active`);
      const unauthBody = resUnauth.json();
      assert.equal(unauthBody.error.code, 'UNAUTHORIZED');

      // 2. With invalid token: 401
      const resWrong = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${WRONG_TOKEN}` },
      });
      assert.equal(resWrong.statusCode, 401);

      // 3. With valid Bearer token: authorized (non-401)
      const resAuth = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      assert.notEqual(resAuth.statusCode, 401, `GET ${url} with valid token must not be 401`);

      // 4. With valid x-api-key header: authorized
      const resApiKey = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-api-key': VALID_TOKEN },
      });
      assert.notEqual(resApiKey.statusCode, 401, `GET ${url} with x-api-key must not be 401`);
    }

    // Health endpoints remain exempt from auth even with protectReads: true
    const healthLive = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(healthLive.statusCode, 200, '/health/live must remain public');

    const healthReady = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(healthReady.statusCode, 200, '/health/ready must remain public');

    const metricsProm = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(metricsProm.statusCode, 200, '/metrics must remain public');

    await app.close();
    console.log('  ✅ protectReads strictly blocks unauthenticated reading of network topology, devices, and usage.');
  }

  // ============================================================================
  // Test 2: Mutation Authorization
  // ============================================================================
  console.log('\n--- Scenario 14.2: State-Modifying Mutation Authorization ---');
  {
    const app = await buildApp({
      authEnabled: true,
      apiToken: VALID_TOKEN,
      protectReads: false, // Even if reads were unauthenticated, writes MUST require auth
    });

    const writeRequests = [
      { method: 'POST', url: '/api/quotas', payload: { mac: '52:54:00:11:22:33', quotaBytes: 1000 } },
      { method: 'PATCH', url: '/api/quotas/52:54:00:11:22:33', payload: { quotaBytes: 2000 } },
      { method: 'DELETE', url: '/api/quotas/52:54:00:11:22:33' },
      { method: 'POST', url: '/api/firewall/block', payload: { mac: '52:54:00:11:22:33' } },
      { method: 'POST', url: '/api/firewall/unblock', payload: { mac: '52:54:00:11:22:33' } },
      { method: 'POST', url: '/api/quota-enforcement/sync' },
    ];

    for (const req of writeRequests) {
      const res = await app.inject({
        method: req.method as any,
        url: req.url,
        payload: req.payload,
      });
      assert.equal(res.statusCode, 401, `${req.method} ${req.url} must require authentication`);
    }

    await app.close();
    console.log('  ✅ 100% of write/mutation routes strictly require authentication.');
  }

  // ============================================================================
  // Test 3: Input Validation & Size Limit Defenses
  // ============================================================================
  console.log('\n--- Scenario 14.3: Input Validation & DoS Defenses ---');
  {
    const app = await buildApp({ authEnabled: false });

    // 1. Invalid MAC in params
    const resInvalidMac = await app.inject({
      method: 'GET',
      url: '/api/quotas/not-a-valid-mac',
    });
    assert.equal(resInvalidMac.statusCode, 400);
    assert.equal(resInvalidMac.json().code, 'VALIDATION_ERROR');

    // 2. Negative quotaBytes
    const resNeg = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: { mac: '52:54:00:11:22:33', quotaBytes: -500 },
    });
    assert.equal(resNeg.statusCode, 400);

    // 3. Float quotaBytes
    const resFloat = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: { mac: '52:54:00:11:22:33', quotaBytes: 1000.5 },
    });
    assert.equal(resFloat.statusCode, 400);

    // 4. Oversized payload (> 64 KB)
    const bigPayload = { mac: '52:54:00:11:22:33', junk: 'x'.repeat(70 * 1024) };
    const resBig = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: bigPayload,
    });
    assert.equal(resBig.statusCode, 413, 'Oversized payload must return 413 Payload Too Large');

    // 5. Malformed JSON syntax
    const resMalformed = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      headers: { 'content-type': 'application/json' },
      body: '{"mac": "invalid json',
    });
    assert.equal(resMalformed.statusCode, 400, 'Malformed JSON must return 400 Bad Request');

    await app.close();
    console.log('  ✅ Schema validation, size limits (64KB), and type guards verified.');
  }

  // ============================================================================
  // Test 4: Command & Shell Injection Prevention
  // ============================================================================
  console.log('\n--- Scenario 14.4: Command & Shell Injection Prevention ---');
  {
    const injectionAttempts = [
      '52:54:00:11:22:33; rm -rf /',
      '52:54:00:11:22:33 && cat /etc/passwd',
      '52:54:00:11:22:33 | reboot',
      '52:54:00:11:22:33`reboot`',
      '52:54:00:11:22:33$(id)',
      '52:54:00:11:22:33\nreboot',
      '52:54:00:11:22:33\0reboot',
    ];

    for (const attack of injectionAttempts) {
      assert.throws(
        () => NftablesSafetyGuard.validateMac(attack),
        /Invalid MAC address|illegal characters/
      );
    }

    // SSH client argument injection defense
    const maliciousSsh = new SshClient();
    await assert.rejects(
      async () => maliciousSsh.executeCommand('nlbw\0injection'),
      /null bytes/
    );

    console.log('  ✅ Zero shell metacharacter passage: strict MAC regex and null-byte defenses active.');
  }

  // ============================================================================
  // Test 5: Rate Limiting Enforcement
  // ============================================================================
  console.log('\n--- Scenario 14.5: Rate Limiting Enforcement ---');
  {
    const app = await buildApp({
      authEnabled: false,
      rateLimitEnabled: true,
      rateLimitMax: 5,
      rateLimitWindowMs: 60000,
    });

    // Make 5 requests within limit
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/quotas' });
      assert.equal(res.statusCode, 200);
    }

    // 6th request must trigger 429 Too Many Requests
    const resBlocked = await app.inject({ method: 'GET', url: '/api/quotas' });
    assert.equal(resBlocked.statusCode, 429, 'Excessive requests must return 429');
    assert.equal(resBlocked.json().code, 'RATE_LIMIT_EXCEEDED');

    // Health check must be exempt
    const resHealth = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(resHealth.statusCode, 200, 'Health check must be exempt from rate limits');

    await app.close();
    console.log('  ✅ Rate limiting correctly blocks traffic at limit and exempts health probes.');
  }

  console.log('\n✅ Stage 14 Security Validation Completed and Passed!\n');
}

void run();

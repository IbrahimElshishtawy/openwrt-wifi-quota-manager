import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { MemoryRateLimiter } from '../src/infrastructure/security/rateLimit.js';

async function runSecurityRateLimitTests() {
  console.log('🧪 Starting Security Rate Limit Tests...');

  // Test 1: Unit testing MemoryRateLimiter
  {
    console.log('Running Test 1: MemoryRateLimiter sliding bucket accounting...');
    const limiter = new MemoryRateLimiter(3, 10000, 2);

    const r1 = limiter.check('1.2.3.4', false);
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 2);

    const r2 = limiter.check('1.2.3.4', false);
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 1);

    const r3 = limiter.check('1.2.3.4', false);
    assert.equal(r3.allowed, true);
    assert.equal(r3.remaining, 0);

    const r4 = limiter.check('1.2.3.4', false);
    assert.equal(r4.allowed, false);

    limiter.close();
    console.log('✅ Test 1 Passed: MemoryRateLimiter limits verified');
  }

  // Test 2: HTTP Integration with Fastify - 429 on limit exceeded
  {
    console.log('Running Test 2: Fastify app returns 429 when rate limit exceeded...');
    const app = await buildApp({
      authEnabled: false,
      rateLimitEnabled: true,
      rateLimitMax: 3,
      rateLimitWindowMs: 5000,
    });

    // Make 3 requests
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/devices',
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['x-ratelimit-limit']);
      assert.ok(res.headers['x-ratelimit-remaining'] !== undefined);
    }

    // 4th request must be throttled
    const blockedRes = await app.inject({
      method: 'GET',
      url: '/api/devices',
    });

    assert.equal(blockedRes.statusCode, 429);
    const body = blockedRes.json();
    assert.equal(body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(blockedRes.headers['retry-after']);

    console.log('✅ Test 2 Passed: 429 Too Many Requests verified with standard error body');
  }

  // Test 3: Health endpoints are exempt from rate limiting
  {
    console.log('Running Test 3: /api/health is exempt from rate limiting...');
    const app = await buildApp({
      authEnabled: false,
      rateLimitEnabled: true,
      rateLimitMax: 2,
      rateLimitWindowMs: 5000,
    });

    // Make 5 requests to health endpoint
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
      });
      assert.equal(res.statusCode, 200);
    }

    console.log('✅ Test 3 Passed: Health endpoint not throttled');
  }

  console.log('🎉 ALL Security Rate Limit Tests PASSED! 🎉\n');
}

void runSecurityRateLimitTests();

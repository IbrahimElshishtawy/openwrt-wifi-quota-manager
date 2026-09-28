import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

async function runSecurityHttpTests() {
  console.log('🧪 Starting Security HTTP & Headers Tests...');

  // Test 1: Security headers present on all HTTP responses
  {
    console.log('Running Test 1: Security headers verified...');
    const app = await buildApp({ authEnabled: false, rateLimitEnabled: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-xss-protection'], '0');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(res.headers['content-security-policy']);
    assert.ok(res.headers['cache-control']?.includes('no-store'));

    console.log('✅ Test 1 Passed: Security headers verified');
  }

  // Test 2: Request ID correlation tracking
  {
    console.log('Running Test 2: Request ID correlation tracking...');
    const app = await buildApp({ authEnabled: false, rateLimitEnabled: false });

    // Incoming valid X-Request-Id is preserved
    const customReqId = 'custom-request-id-12345';
    const resWithId = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        'x-request-id': customReqId,
      },
    });

    assert.equal(resWithId.headers['x-request-id'], customReqId);

    // Auto-generated when omitted
    const resWithoutId = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    const generatedId = resWithoutId.headers['x-request-id'];
    assert.ok(generatedId);
    assert.ok(typeof generatedId === 'string');
    assert.ok(generatedId.length >= 8);

    // Malformed X-Request-Id replaced with safe UUID
    const resMalformedId = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        'x-request-id': 'bad;injection<script>',
      },
    });

    const sanitizedId = resMalformedId.headers['x-request-id'];
    assert.notEqual(sanitizedId, 'bad;injection<script>');
    assert.ok(sanitizedId);

    console.log('✅ Test 2 Passed: Request ID correlation and sanitization verified');
  }

  // Test 3: Oversized request rejection (bodyLimit: 64KB)
  {
    console.log('Running Test 3: Oversized payload rejected with 413...');
    const app = await buildApp({ authEnabled: false, rateLimitEnabled: false });

    // Construct 100KB payload
    const bigPayload = JSON.stringify({
      mac: '52:54:00:11:22:33',
      data: 'x'.repeat(100 * 1024),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/block',
      headers: {
        'content-type': 'application/json',
      },
      payload: bigPayload,
    });

    assert.equal(res.statusCode, 413);
    const body = res.json();
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.ok(body.error.requestId);

    console.log('✅ Test 3 Passed: 413 Payload Too Large returned for oversized body');
  }

  // Test 4: Standardized 404 response
  {
    console.log('Running Test 4: Standardized 404 response structure...');
    const app = await buildApp({ authEnabled: false, rateLimitEnabled: false });

    const res = await app.inject({
      method: 'GET',
      url: '/non-existent-endpoint',
    });

    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.requestId);
    assert.ok(body.error.message.includes('/non-existent-endpoint'));

    console.log('✅ Test 4 Passed: 404 Not Found formatted in standardized JSON structure');
  }

  console.log('🎉 ALL Security HTTP Tests PASSED! 🎉\n');
}

void runSecurityHttpTests();

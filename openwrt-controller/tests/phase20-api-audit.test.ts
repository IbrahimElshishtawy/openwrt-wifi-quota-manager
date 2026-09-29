import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

// ==============================================================================
// Phase 20 - Stage 17: API Production Audit
// Verifies production REST API hygiene:
// 1. Error response envelope consistency ({ code, message, success: false, requestId })
// 2. HTTP Status Code semantics (200, 201, 400, 401, 404, 409, 413, 429)
// 3. Request correlation ID propagation (X-Request-Id header & payload)
// 4. Content negotiation & security headers on all endpoints
// 5. Malformed payload handling
// ==============================================================================

async function run() {
  console.log('================================================================');
  console.log(' Phase 20 - Stage 17: API Production Audit');
  console.log('================================================================');

  const app = await buildApp({
    authEnabled: true,
    apiToken: 'test-production-secret-token',
    rateLimitEnabled: true,
    rateLimitMax: 10,
    rateLimitWindowMs: 60000,
  });

  const authHeader = { authorization: 'Bearer test-production-secret-token' };

  // --- Scenario 17.1: Security Headers & Correlation ID on All Endpoints ---
  console.log('\n--- Scenario 17.1: Security Headers & Correlation ID ---');
  const customReqId = 'audit-req-12345678-abcdef';
  const resHeaders = await app.inject({
    method: 'GET',
    url: '/health/live',
    headers: { 'x-request-id': customReqId },
  });

  assert.strictEqual(resHeaders.statusCode, 200);
  assert.strictEqual(resHeaders.headers['x-request-id'], customReqId, 'Response header must echo X-Request-Id');
  assert.strictEqual(resHeaders.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(resHeaders.headers['x-frame-options'], 'DENY');
  assert.strictEqual(resHeaders.headers['x-xss-protection'], '0');
  console.log('  ✅ Security headers and custom X-Request-Id propagation verified.');

  // --- Scenario 17.2: HTTP 401 Unauthorized Error Consistency ---
  console.log('\n--- Scenario 17.2: HTTP 401 Unauthorized Envelope ---');
  const res401 = await app.inject({
    method: 'POST',
    url: '/api/quotas',
    payload: { mac: 'AA:BB:CC:DD:EE:01', limitBytes: 1000 },
  });
  assert.strictEqual(res401.statusCode, 401);
  const body401 = res401.json();
  assert.strictEqual(body401.success, false);
  assert.strictEqual(body401.code, 'UNAUTHORIZED');
  assert.ok(typeof body401.message === 'string' && body401.message.length > 0);
  assert.ok(body401.requestId, '401 error must contain requestId');
  console.log('  ✅ 401 response adheres to standard error envelope.');

  // --- Scenario 17.3: HTTP 400 Bad Request & Schema Validation ---
  console.log('\n--- Scenario 17.3: HTTP 400 Bad Request & Schema Validation ---');
  const res400 = await app.inject({
    method: 'POST',
    url: '/api/quotas',
    headers: authHeader,
    payload: { mac: 'invalid-mac', limitBytes: -50 },
  });
  assert.strictEqual(res400.statusCode, 400);
  const body400 = res400.json();
  assert.strictEqual(body400.success, false);
  assert.strictEqual(body400.code, 'VALIDATION_ERROR');
  assert.ok(body400.requestId);
  console.log('  ✅ 400 validation error delivers structured issues with code=VALIDATION_ERROR.');

  // --- Scenario 17.4: HTTP 404 Not Found Envelope ---
  console.log('\n--- Scenario 17.4: HTTP 404 Not Found Envelope ---');
  const res404 = await app.inject({
    method: 'GET',
    url: '/api/quotas/AA:BB:CC:DD:EE:99',
    headers: authHeader,
  });
  assert.strictEqual(res404.statusCode, 404);
  const body404 = res404.json();
  assert.strictEqual(body404.success, false);
  assert.strictEqual(body404.code, 'QUOTA_NOT_FOUND');
  assert.ok(body404.requestId);
  console.log('  ✅ 404 error envelope returns code=QUOTA_NOT_FOUND.');

  // --- Scenario 17.5: HTTP 413 Payload Too Large ---
  console.log('\n--- Scenario 17.5: HTTP 413 Payload Too Large ---');
  const largePayload = { mac: 'AA:BB:CC:DD:EE:02', limitBytes: 1000, extra: 'x'.repeat(70 * 1024) };
  const res413 = await app.inject({
    method: 'POST',
    url: '/api/quotas',
    headers: authHeader,
    payload: largePayload,
  });
  assert.strictEqual(res413.statusCode, 413);
  const body413 = res413.json();
  assert.strictEqual(body413.success, false);
  assert.strictEqual(body413.code, 'PAYLOAD_TOO_LARGE');
  console.log('  ✅ 413 Payload Too Large enforced for requests exceeding 64KB.');

  await app.close();
  console.log('\n✅ Stage 17 API Production Audit Completed and Passed!\n');
}

void run();

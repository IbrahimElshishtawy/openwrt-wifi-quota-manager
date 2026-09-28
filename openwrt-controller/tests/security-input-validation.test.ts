import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createQuotaSchema, updateQuotaSchema } from '../src/modules/quota/quota.schemas.js';
import { NftablesSafetyGuard } from '../src/modules/firewall/NftablesSafetyGuard.js';
import { InvalidMacAddressError } from '../src/modules/firewall/types.js';

async function runSecurityInputValidationTests() {
  console.log('🧪 Starting Security Input Validation Tests...');

  // Test 1: Malformed MAC address rejection
  {
    console.log('Running Test 1: Malformed MAC addresses rejected by NftablesSafetyGuard...');
    const invalidMacs = [
      '',
      'invalid-mac',
      '52:54:00:11:22',
      '52:54:00:11:22:33:44',
      '52:54:00:11:22:GG',
      '52:54:00:11:22:33; rm -rf /',
      '52:54:00:11:22:33 | reboot',
      '$(reboot)',
      '52:54:00:11:22:33\nreboot',
    ];

    for (const badMac of invalidMacs) {
      assert.throws(
        () => NftablesSafetyGuard.validateMac(badMac),
        (err) => err instanceof InvalidMacAddressError
      );
    }
    console.log('✅ Test 1 Passed: Malformed MAC addresses strictly rejected');
  }

  // Test 2: Quota validation schemas: negative, zero, float, NaN, Infinity, overflow
  {
    console.log('Running Test 2: Quota number edge cases (negative, zero, NaN, Infinity, MAX_SAFE_INTEGER)...');
    
    // Valid quota
    assert.ok(createQuotaSchema.safeParse({ mac: '52:54:00:11:22:33', quotaBytes: 5000 }).success);

    // Negative
    assert.equal(createQuotaSchema.safeParse({ mac: '52:54:00:11:22:33', quotaBytes: -100 }).success, false);

    // Zero
    assert.equal(createQuotaSchema.safeParse({ mac: '52:54:00:11:22:33', quotaBytes: 0 }).success, false);

    // Float
    assert.equal(createQuotaSchema.safeParse({ mac: '52:54:00:11:22:33', quotaBytes: 1000.5 }).success, false);

    // Infinity
    assert.equal(createQuotaSchema.safeParse({ mac: '52:54:00:11:22:33', quotaBytes: Infinity }).success, false);

    // Beyond MAX_SAFE_INTEGER
    assert.equal(
      createQuotaSchema.safeParse({ mac: '52:54:00:11:22:33', quotaBytes: Number.MAX_SAFE_INTEGER + 1000 }).success,
      false
    );

    // Update quota validation
    assert.equal(updateQuotaSchema.safeParse({ usedBytes: -1 }).success, false);
    assert.equal(updateQuotaSchema.safeParse({ usedBytes: Infinity }).success, false);
    assert.equal(updateQuotaSchema.safeParse({ usedBytes: Number.MAX_SAFE_INTEGER + 1000 }).success, false);

    console.log('✅ Test 2 Passed: Quota number bounds and integer safety verified');
  }

  // Test 3: HTTP API level rejection of malformed MAC and quota
  {
    console.log('Running Test 3: API endpoints reject invalid parameters with 400...');
    const app = await buildApp({ authEnabled: false, rateLimitEnabled: false });

    // Invalid MAC in URL parameter
    const resBadMac = await app.inject({
      method: 'GET',
      url: '/api/quotas/invalid-mac-format',
    });
    assert.equal(resBadMac.statusCode, 400);
    const bodyBadMac = resBadMac.json();
    assert.equal(bodyBadMac.success, false);
    assert.equal(bodyBadMac.code, 'VALIDATION_ERROR');

    // Negative quota in body
    const resBadQuota = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      payload: {
        mac: '52:54:00:11:22:33',
        quotaBytes: -500,
      },
    });
    assert.equal(resBadQuota.statusCode, 400);

    // Malformed JSON payload
    const resBadJson = await app.inject({
      method: 'POST',
      url: '/api/quotas',
      headers: { 'content-type': 'application/json' },
      payload: '{"mac": "52:54:00:11:22:33", malformed}',
    });
    assert.equal(resBadJson.statusCode, 400);

    console.log('✅ Test 3 Passed: HTTP API returns standardized 400 errors for bad input');
  }

  console.log('🎉 ALL Security Input Validation Tests PASSED! 🎉\n');
}

void runSecurityInputValidationTests();

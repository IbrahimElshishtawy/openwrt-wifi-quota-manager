import assert from 'node:assert/strict';
import { Logger } from '../src/infrastructure/logging/Logger.js';
import type { StructuredLogEntry } from '../src/infrastructure/logging/logger.types.js';

async function runSecuritySecretsTests() {
  console.log('🧪 Starting Security Secrets & Redaction Tests...');

  // Test 1: Redaction of sensitive keys in bindings and context
  {
    console.log('Running Test 1: Sensitive keys sanitized in log entries...');
    const loggedEntries: Array<{ entry: StructuredLogEntry; json: string }> = [];

    const logger = new Logger({
      minLevel: 'debug',
      sink: (entry, json) => {
        loggedEntries.push({ entry, json });
      },
    });

    logger.info('User login event', {
      username: 'admin',
      password: 'super-secret-password-123',
      token: 'jwt-access-token-xyz',
      apiKey: 'api-secret-key-456',
      privateKey: 'my-private-key-material',
      credentials: {
        adminToken: 'admin-token-789',
        secret: 'raw-secret',
      },
    });

    assert.equal(loggedEntries.length, 1);
    const first = loggedEntries[0]!;
    assert.equal(first.entry.password, '[REDACTED]');
    assert.equal(first.entry.token, '[REDACTED]');
    assert.equal(first.entry.apiKey, '[REDACTED]');
    assert.equal(first.entry.privateKey, '[REDACTED]');

    // Ensure raw secrets do not appear anywhere in formatted JSON output
    assert.ok(!first.json.includes('super-secret-password-123'));
    assert.ok(!first.json.includes('jwt-access-token-xyz'));
    assert.ok(!first.json.includes('api-secret-key-456'));
    assert.ok(!first.json.includes('my-private-key-material'));
    assert.ok(!first.json.includes('admin-token-789'));
    assert.ok(!first.json.includes('raw-secret'));

    console.log('✅ Test 1 Passed: Sensitive keys completely redacted from structured log');
  }

  // Test 2: Redaction of sensitive patterns in message strings
  {
    console.log('Running Test 2: Sensitive string patterns (Bearer, KV, Private Keys, URL credentials)...');
    const loggedEntries: Array<{ entry: StructuredLogEntry; json: string }> = [];

    const logger = new Logger({
      minLevel: 'debug',
      sink: (entry, json) => {
        loggedEntries.push({ entry, json });
      },
    });

    const privateKeyBlock = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const bearerString = 'Authorization failed: Bearer secret-auth-token-12345';
    const urlString = 'Connecting to http://root:supersecret@192.168.50.1/ubus';
    const kvString = 'config error: password=mypassword&token=mytoken';

    logger.error(`${bearerString} | ${urlString} | ${kvString} | ${privateKeyBlock}`);

    assert.equal(loggedEntries.length, 1);
    const json = loggedEntries[0]!.json;

    assert.ok(!json.includes('secret-auth-token-12345'));
    assert.ok(json.includes('Bearer [REDACTED]'));

    assert.ok(!json.includes('supersecret'));
    assert.ok(json.includes('[REDACTED]'));

    assert.ok(!json.includes('mypassword'));
    assert.ok(!json.includes('mytoken'));
    assert.ok(json.includes('password=[REDACTED]'));
    assert.ok(json.includes('token=[REDACTED]'));

    assert.ok(!json.includes('MIIEowIBAAKCAQEA'));
    assert.ok(json.includes('[REDACTED PRIVATE KEY]'));

    console.log('✅ Test 2 Passed: String patterns redacted (Bearer, URLs, KV pairs, Private Keys)');
  }

  // Test 3: Redaction of sensitive data in arrays of objects
  {
    console.log('Running Test 3: Recursive redaction inside nested arrays...');
    const loggedEntries: Array<{ entry: StructuredLogEntry; json: string }> = [];

    const logger = new Logger({
      minLevel: 'debug',
      sink: (entry, json) => {
        loggedEntries.push({ entry, json });
      },
    });

    logger.info('Batch processing users', {
      items: [
        { id: 1, token: 'token-in-array-1' },
        { id: 2, password: 'password-in-array-2' },
      ],
    });

    assert.equal(loggedEntries.length, 1);
    const json = loggedEntries[0]!.json;

    assert.ok(!json.includes('token-in-array-1'));
    assert.ok(!json.includes('password-in-array-2'));

    console.log('✅ Test 3 Passed: Nested arrays of credentials redacted');
  }

  console.log('🎉 ALL Security Secrets & Redaction Tests PASSED! 🎉\n');
}

void runSecuritySecretsTests();

import assert from 'node:assert/strict';
import { validateProductionConfig, envSchema, type Env } from '../src/config/env.js';

async function runProductionConfigTests() {
  console.log('🧪 Starting Production Configuration Validation Tests...');

  // Test 1: Development mode skips production restrictions
  {
    console.log('Running Test 1: Development mode permits defaults...');
    const devParsed = envSchema.parse({
      NODE_ENV: 'development',
      OPENWRT_PASSWORD: 'CHANGE_ME',
      CORS_ORIGIN: '*',
    });

    const devErrors = validateProductionConfig(devParsed);
    assert.equal(devErrors.length, 0);
    console.log('✅ Test 1 Passed: Development mode allows developer defaults');
  }

  // Test 2: Production mode rejects missing credentials and secrets
  {
    console.log('Running Test 2: Production mode rejects missing or insecure settings...');
    const badProd: Env = {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      CORS_ORIGIN: '*', // PROHIBITED in prod
      OPENWRT_HOST: '', // MISSING
      OPENWRT_PORT: 80,
      OPENWRT_USERNAME: '', // MISSING
      OPENWRT_PASSWORD: 'CHANGE_ME', // INSECURE DEFAULT
      OPENWRT_USE_HTTPS: false,
      OPENWRT_SSH_PORT: 22,
      OPENWRT_SSH_USER: 'root',
      OPENWRT_SSH_TIMEOUT_MS: 5000,
      API_AUTH_TOKEN: 'short', // TOO SHORT (< 16 chars)
      API_RATE_LIMIT_MAX: 100,
      API_RATE_LIMIT_WINDOW_MS: 60000,
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
      CIRCUIT_BREAKER_COOLDOWN_MS: 10000,
      QUOTA_STORAGE_PATH: 'data/quotas.json',
      QUOTA_ENFORCEMENT_ENABLED: true,
      QUOTA_ENFORCEMENT_INTERVAL_MS: 5000,
      FIREWALL_STORAGE_PATH: 'data/firewall-blocks.json',
    };

    const errors = validateProductionConfig(badProd);
    assert.ok(errors.length >= 4);
    assert.ok(errors.some((e) => e.includes('OPENWRT_HOST is required')));
    assert.ok(errors.some((e) => e.includes('OPENWRT_USERNAME is required')));
    assert.ok(errors.some((e) => e.includes('OPENWRT_PASSWORD cannot be an insecure default')));
    assert.ok(errors.some((e) => e.includes('API_AUTH_TOKEN must be at least 16 characters')));
    assert.ok(errors.some((e) => e.includes('CORS_ORIGIN="*" is prohibited')));

    console.log(`✅ Test 2 Passed: Caught ${errors.length} production violations`);
  }

  // Test 3: Production mode accepts robust configuration
  {
    console.log('Running Test 3: Production mode validates strong configuration successfully...');
    const goodProd: Env = {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 3000,
      CORS_ORIGIN: 'https://admin.openwrt-quota.local',
      OPENWRT_HOST: '192.168.50.1',
      OPENWRT_PORT: 443,
      OPENWRT_USERNAME: 'admin_user',
      OPENWRT_PASSWORD: 'ComplexProductionPassword987!#',
      OPENWRT_USE_HTTPS: true,
      OPENWRT_SSH_PORT: 2222,
      OPENWRT_SSH_USER: 'admin_ssh',
      OPENWRT_SSH_TIMEOUT_MS: 5000,
      API_AUTH_TOKEN: 'SuperSecureLongProductionApiToken2026!#$',
      API_RATE_LIMIT_MAX: 120,
      API_RATE_LIMIT_WINDOW_MS: 60000,
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
      CIRCUIT_BREAKER_COOLDOWN_MS: 10000,
      QUOTA_STORAGE_PATH: 'data/quotas.json',
      QUOTA_ENFORCEMENT_ENABLED: true,
      QUOTA_ENFORCEMENT_INTERVAL_MS: 5000,
      FIREWALL_STORAGE_PATH: 'data/firewall-blocks.json',
    };

    const errors = validateProductionConfig(goodProd);
    assert.equal(errors.length, 0, `Expected 0 errors, got: ${errors.join(', ')}`);
    console.log('✅ Test 3 Passed: Hardened production configuration accepted with 0 errors');
  }

  console.log('🎉 ALL Production Configuration Tests PASSED! 🎉\n');
}

void runProductionConfigTests();

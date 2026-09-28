import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version.js';
import { validateProductionConfig, envSchema, type Env } from '../src/config/env.js';
import { buildApp } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function runPhase19Tests() {
  console.log('🧪 Starting Phase 19 — Production Deployment, Packaging & Operational Tooling Tests...\n');

  // =========================================================================
  // Section 1: Versioning & Single Source of Truth
  // =========================================================================
  {
    console.log('Running Test 1: Versioning & Single Source of Truth...');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));

    assert.equal(APP_VERSION, pkg.version, 'APP_VERSION must match package.json version exactly');

    // Check version in operations status response
    const app = await buildApp({ authEnabled: false, rateLimitEnabled: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/operations/status',
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<{ controllerVersion: string }>();
    assert.equal(body.controllerVersion, APP_VERSION, 'Operations status should reflect APP_VERSION');
    await app.close();
    console.log('✅ Test 1 Passed: Single source of truth for versioning verified');
  }

  // =========================================================================
  // Section 2: Production Configuration Validation
  // =========================================================================
  {
    console.log('Running Test 2: Production Configuration Validation...');

    const baseProdConfig: Env = {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      CORS_ORIGIN: 'http://127.0.0.1:3000',
      API_AUTH_TOKEN: 'super-secure-production-token-12345',
      ADMIN_API_TOKEN: undefined,
      API_RATE_LIMIT_MAX: 100,
      API_RATE_LIMIT_WINDOW_MS: 60000,
      OPENWRT_HOST: '192.168.50.1',
      OPENWRT_PORT: 80,
      OPENWRT_USERNAME: 'root',
      OPENWRT_PASSWORD: 'secure_password_987',
      OPENWRT_USE_HTTPS: false,
      OPENWRT_SSH_PORT: 22,
      OPENWRT_SSH_USER: 'root',
      OPENWRT_SSH_KEY_PATH: undefined,
      OPENWRT_SSH_TIMEOUT_MS: 5000,
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
      CIRCUIT_BREAKER_COOLDOWN_MS: 10000,
      QUOTA_STORAGE_PATH: 'data/quotas.json',
      QUOTA_ENFORCEMENT_ENABLED: true,
      QUOTA_ENFORCEMENT_INTERVAL_MS: 5000,
      FIREWALL_STORAGE_PATH: 'data/firewall-blocks.json',
      SHUTDOWN_TIMEOUT_MS: 5000,
    };

    // 1. Valid config should produce 0 errors
    const validErrors = validateProductionConfig(baseProdConfig);
    assert.equal(validErrors.length, 0, 'Valid production config should produce no errors');

    // 2. Wildcard CORS prohibited
    const wildcardErrors = validateProductionConfig({ ...baseProdConfig, CORS_ORIGIN: '*' });
    assert.ok(wildcardErrors.some((e) => e.includes('CORS_ORIGIN="*" is prohibited')));

    // 3. Short API token rejected
    const shortTokenErrors = validateProductionConfig({ ...baseProdConfig, API_AUTH_TOKEN: 'short' });
    assert.ok(shortTokenErrors.some((e) => e.includes('at least 16 characters')));

    // 4. Insecure password rejected
    const insecurePassErrors = validateProductionConfig({ ...baseProdConfig, OPENWRT_PASSWORD: 'change_me' });
    assert.ok(insecurePassErrors.some((e) => e.includes('cannot be an insecure default')));

    console.log('✅ Test 2 Passed: Production configuration validation rules verified');
  }

  // =========================================================================
  // Section 3: Operational CLI (wifi-controller)
  // =========================================================================
  {
    console.log('Running Test 3: Operational CLI execution & error handling...');
    const cliPath = path.join(ROOT_DIR, 'bin', 'wifi-controller.js');

    // 1. Version command
    const versionOut = execFileSync('node', [cliPath, 'version']).toString();
    assert.ok(versionOut.includes(APP_VERSION), 'CLI version command should output current APP_VERSION');

    // 2. Version JSON command
    const versionJsonOut = execFileSync('node', [cliPath, 'version', '--json']).toString();
    const parsedVersion = JSON.parse(versionJsonOut);
    assert.equal(parsedVersion.version, APP_VERSION);

    // 3. Help command
    const helpOut = execFileSync('node', [cliPath, '--help']).toString();
    assert.ok(helpOut.includes('OpenWrt WiFi Quota Controller CLI'));
    assert.ok(helpOut.includes('COMMANDS:'));

    // 4. Invalid command exit code 2
    let invalidCommandExitedCorrectly = false;
    try {
      execFileSync('node', [cliPath, 'nonexistent-command'], { stdio: 'pipe' });
    } catch (err: unknown) {
      const exitCode = (err as { status?: number }).status;
      assert.equal(exitCode, 2, 'Invalid CLI command should exit with code 2');
      invalidCommandExitedCorrectly = true;
    }
    assert.ok(invalidCommandExitedCorrectly);

    console.log('✅ Test 3 Passed: wifi-controller CLI commands and arguments verified');
  }

  // =========================================================================
  // Section 4: State Backup, Restore & Rollback Verification
  // =========================================================================
  {
    console.log('Running Test 4: State Backup and Restore Tooling...');
    const testDataDir = path.join(ROOT_DIR, 'backups', 'test_data_' + Date.now());
    const testBackupDir = path.join(ROOT_DIR, 'backups', 'test_backups_' + Date.now());
    fs.mkdirSync(testDataDir, { recursive: true });
    fs.mkdirSync(testBackupDir, { recursive: true });

    try {
      // 1. Write sample state
      const sampleQuotas = [{ mac: '52:54:00:11:22:33', quotaBytes: 1000000 }];
      const sampleBlocks = { manualBlockedMacs: ['52:54:00:AA:BB:CC'], quotaBlockedMacs: [] };
      fs.writeFileSync(path.join(testDataDir, 'quotas.json'), JSON.stringify(sampleQuotas, null, 2));
      fs.writeFileSync(path.join(testDataDir, 'firewall-blocks.json'), JSON.stringify(sampleBlocks, null, 2));

      // 2. Run backup script
      const backupScript = path.join(ROOT_DIR, 'deploy', 'backup.sh');
      const backupOut = execFileSync('bash', [backupScript], {
        env: {
          ...process.env,
          DATA_DIR: testDataDir,
          BACKUP_DIR: testBackupDir,
        },
      }).toString();

      assert.ok(backupOut.includes('Backup successfully created'), 'Backup script should report success');
      const latestBackupDir = path.join(testBackupDir, 'latest');
      assert.ok(fs.existsSync(latestBackupDir), 'Latest backup symlink should exist');
      assert.ok(fs.existsSync(path.join(latestBackupDir, 'metadata.json')), 'metadata.json should exist');
      assert.ok(fs.existsSync(path.join(latestBackupDir, 'quotas.json')), 'quotas.json should be backed up');

      // 3. Test corruption detection during backup
      fs.writeFileSync(path.join(testDataDir, 'quotas.json'), '{ invalid json string');
      let backupFailedOnCorrupt = false;
      try {
        execFileSync('bash', [backupScript], {
          env: {
            ...process.env,
            DATA_DIR: testDataDir,
            BACKUP_DIR: testBackupDir,
          },
          stdio: 'pipe',
        });
      } catch {
        backupFailedOnCorrupt = true;
      }
      assert.ok(backupFailedOnCorrupt, 'Backup script must reject corrupt JSON file');

      // 4. Test restore from valid backup
      const restoreScript = path.join(ROOT_DIR, 'deploy', 'restore.sh');
      execFileSync('bash', [restoreScript, latestBackupDir], {
        env: {
          ...process.env,
          DATA_DIR: testDataDir,
          BACKUP_DIR: testBackupDir,
        },
      });

      // Assert quotas.json was restored to valid state
      const restoredQuotas = JSON.parse(fs.readFileSync(path.join(testDataDir, 'quotas.json'), 'utf8'));
      assert.deepEqual(restoredQuotas, sampleQuotas, 'Restored quotas must match original snapshot');
    } finally {
      // Clean up test directories
      fs.rmSync(testDataDir, { recursive: true, force: true });
      fs.rmSync(testBackupDir, { recursive: true, force: true });
    }

    console.log('✅ Test 4 Passed: Backup, integrity validation and restoration verified');
  }

  // =========================================================================
  // Section 5: Prometheus & Alerting Specifications
  // =========================================================================
  {
    console.log('Running Test 5: Prometheus Scrape & Alert Rules Specification...');
    const prometheusConfigPath = path.join(ROOT_DIR, 'deploy', 'prometheus', 'prometheus.yml');
    const alertsConfigPath = path.join(ROOT_DIR, 'deploy', 'prometheus', 'alerts.yml');

    assert.ok(fs.existsSync(prometheusConfigPath), 'prometheus.yml must exist');
    assert.ok(fs.existsSync(alertsConfigPath), 'alerts.yml must exist');

    const promContent = fs.readFileSync(prometheusConfigPath, 'utf8');
    assert.ok(promContent.includes('/metrics'), 'prometheus.yml must scrape /metrics');
    assert.ok(promContent.includes('alerts.yml'), 'prometheus.yml must include alerts.yml');

    const alertsContent = fs.readFileSync(alertsConfigPath, 'utf8');
    assert.ok(alertsContent.includes('alert: OpenWrtControllerDown'), 'Alert OpenWrtControllerDown must exist');
    assert.ok(alertsContent.includes('alert: OpenWrtCircuitBreakerOpen'), 'Alert OpenWrtCircuitBreakerOpen must exist');
    assert.ok(alertsContent.includes('alert: QuotaEnforcementCycleFailures'), 'Alert QuotaEnforcementCycleFailures must exist');
    assert.ok(alertsContent.includes('resilience_circuit_breaker_state == 2'), 'Must reference real metric name');
    assert.ok(alertsContent.includes('process_memory_rss_bytes'), 'Must reference process_memory_rss_bytes');

    console.log('✅ Test 5 Passed: Prometheus configuration and alert rules verified');
  }

  // =========================================================================
  // Section 6: Grafana Dashboard Schema & Metric Queries
  // =========================================================================
  {
    console.log('Running Test 6: Grafana Dashboard Template Validation...');
    const dashboardPath = path.join(ROOT_DIR, 'deploy', 'grafana', 'openwrt-controller-dashboard.json');
    assert.ok(fs.existsSync(dashboardPath), 'openwrt-controller-dashboard.json must exist');

    const dashboard = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));
    assert.ok(dashboard.title.includes('OpenWrt WiFi Quota Manager'), 'Dashboard title should be descriptive');
    assert.ok(Array.isArray(dashboard.panels), 'Dashboard must contain panels array');
    assert.ok(dashboard.panels.length >= 10, 'Dashboard must contain at least 10 panels across categories');

    const targets = dashboard.panels.flatMap((p: { targets?: Array<{ expr: string }> }) => p.targets || []);
    const expressions = targets.map((t: { expr: string }) => t.expr).join(' ');

    assert.ok(expressions.includes('http_requests_total'), 'Dashboard must query http_requests_total');
    assert.ok(expressions.includes('resilience_circuit_breaker_state'), 'Dashboard must query resilience_circuit_breaker_state');
    assert.ok(expressions.includes('openwrt_ssh_'), 'Dashboard must query openwrt_ssh_ metrics');
    assert.ok(expressions.includes('quota_enforcement_cycles_total'), 'Dashboard must query quota_enforcement_cycles_total');

    console.log('✅ Test 6 Passed: Grafana dashboard template schema and queries verified');
  }

  // =========================================================================
  // Section 7: Systemd Service & Dockerfile Hardening Specification
  // =========================================================================
  {
    console.log('Running Test 7: Systemd Service & Dockerfile Security Hardening...');
    const systemdPath = path.join(ROOT_DIR, 'deploy', 'systemd', 'openwrt-controller.service');
    assert.ok(fs.existsSync(systemdPath), 'openwrt-controller.service must exist');

    const systemdContent = fs.readFileSync(systemdPath, 'utf8');
    assert.ok(systemdContent.includes('NoNewPrivileges=true'), 'Systemd must enforce NoNewPrivileges');
    assert.ok(systemdContent.includes('KillSignal=SIGTERM'), 'Systemd must use SIGTERM');
    assert.ok(systemdContent.includes('Restart=always'), 'Systemd must configure automatic restart');
    assert.ok(systemdContent.includes('ProtectSystem=strict'), 'Systemd must enforce ProtectSystem=strict');
    assert.ok(systemdContent.includes('StandardOutput=journal'), 'Systemd must output to journald');

    const dockerfilePath = path.join(ROOT_DIR, 'Dockerfile');
    assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist');

    const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
    assert.ok(dockerContent.includes('AS builder'), 'Dockerfile must use multi-stage builder');
    assert.ok(dockerContent.includes('AS runner'), 'Dockerfile must use runner stage');
    assert.ok(dockerContent.includes('USER node'), 'Dockerfile must execute as non-root user');
    assert.ok(dockerContent.includes('HEALTHCHECK'), 'Dockerfile must specify container HEALTHCHECK');
    assert.ok(dockerContent.includes('openssh-client'), 'Dockerfile must install openssh-client');

    console.log('✅ Test 7 Passed: Systemd and Docker hardening specifications verified');
  }

  // =========================================================================
  // Section 8: Quota Enforcement Sync Route & Security Posture
  // =========================================================================
  {
    console.log('Running Test 8: Quota Enforcement Sync Trigger & Security Protection...');
    const app = await buildApp({
      authEnabled: true,
      apiToken: 'test-admin-secret-token-12345',
      rateLimitEnabled: false,
    });

    // 1. Unauthenticated POST /api/quota-enforcement/sync must be rejected with 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/quota-enforcement/sync',
    });
    assert.equal(unauthRes.statusCode, 401, 'Unauthenticated sync trigger must return 401');

    // 2. Authenticated POST /api/quota-enforcement/sync should succeed with 200
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/quota-enforcement/sync',
      headers: {
        Authorization: 'Bearer test-admin-secret-token-12345',
      },
    });
    assert.equal(authRes.statusCode, 200, 'Authenticated sync trigger should return 200');
    const syncBody = authRes.json<{ success: boolean; message: string }>();
    assert.equal(syncBody.success, true);
    assert.ok(syncBody.message.includes('Enforcement and reconciliation cycle triggered'));

    await app.close();
    console.log('✅ Test 8 Passed: Quota enforcement sync trigger and auth protection verified');
  }

  console.log('\n🎉 ALL Phase 19 Production Deployment & Packaging Tests PASSED! 🎉\n');
}

runPhase19Tests().catch((err) => {
  console.error('❌ Phase 19 Test Failure:', err);
  process.exit(1);
});

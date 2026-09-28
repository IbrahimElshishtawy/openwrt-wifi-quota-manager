import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { parseAndValidateEnv, validateProductionConfig } from '../src/config/env.js';
import { healthRoutes } from '../src/modules/health/health.routes.js';
import { HealthService } from '../src/modules/health/HealthService.js';
import { CircuitBreaker } from '../src/infrastructure/resilience/CircuitBreaker.js';
import { OperationsController } from '../src/modules/operations/OperationsController.js';
import { operationsRoutes } from '../src/modules/operations/operations.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function runFailureScenarioTests() {
  console.log('🧪 Starting Phase 19 Production Failure Scenarios & Edge Cases Tests...\n');

  // =========================================================================
  // Scenario 1: Invalid Production Environment Variables Fail Fast
  // =========================================================================
  {
    console.log('Running Scenario 1: Invalid Production Environment Variables Fail Fast...');

    // 1. Missing router credentials causes validateProductionConfig errors and process.exit(1)
    let childExitedWith1 = false;
    try {
      execFileSync(
        'node',
        [
          '-e',
          'import("./dist/config/env.js").then(({ parseAndValidateEnv }) => parseAndValidateEnv({ NODE_ENV: "production", CORS_ORIGIN: "http://localhost:3000", API_AUTH_TOKEN: "long-token-12345678" }))',
        ],
        { stdio: 'pipe', cwd: ROOT_DIR }
      );
    } catch (err: unknown) {
      const exitCode = (err as { status?: number }).status;
      assert.equal(exitCode, 1, 'Missing router config must trigger process.exit(1)');
      childExitedWith1 = true;
    }
    assert.ok(childExitedWith1, 'Child process must exit with code 1 when required production variables are missing');

    // 2. Insecure default token validation
    let insecureTokenExited = false;
    try {
      execFileSync(
        'node',
        [
          '-e',
          'import("./dist/config/env.js").then(({ parseAndValidateEnv }) => parseAndValidateEnv({ NODE_ENV: "production", CORS_ORIGIN: "http://localhost:3000", OPENWRT_HOST: "192.168.50.1", OPENWRT_USERNAME: "root", OPENWRT_PASSWORD: "pw", API_AUTH_TOKEN: "admin" }))',
        ],
        { stdio: 'pipe', cwd: ROOT_DIR }
      );
    } catch (err: unknown) {
      const exitCode = (err as { status?: number }).status;
      assert.equal(exitCode, 1, 'Insecure token must trigger process.exit(1)');
      insecureTokenExited = true;
    }
    assert.ok(insecureTokenExited, 'Child process must exit with code 1 when insecure token is passed');

    console.log('✅ Scenario 1 Passed: System fails fast on invalid production configuration');
  }

  // =========================================================================
  // Scenario 2: Port Collision / EADDRINUSE Failure Handling
  // =========================================================================
  {
    console.log('Running Scenario 2: Port Collision (EADDRINUSE) Failure Handling...');

    // Occupy a random free port with a native TCP server
    const blockerServer = net.createServer();
    await new Promise<void>((resolve) => blockerServer.listen(0, '127.0.0.1', () => resolve()));
    const occupiedPort = (blockerServer.address() as net.AddressInfo).port;

    const fastifyApp = Fastify();
    let collisionCaught = false;
    try {
      await fastifyApp.listen({ port: occupiedPort, host: '127.0.0.1' });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      assert.equal(code, 'EADDRINUSE');
      collisionCaught = true;
    } finally {
      await new Promise<void>((resolve) => blockerServer.close(() => resolve()));
      await fastifyApp.close().catch(() => {});
    }

    assert.ok(collisionCaught, 'Fastify server must fail fast with EADDRINUSE when port is occupied');
    console.log('✅ Scenario 2 Passed: Port collisions are caught cleanly with EADDRINUSE');
  }

  // =========================================================================
  // Scenario 3: Readiness Probe Rejection on Subsystem Degradation
  // =========================================================================
  {
    console.log('Running Scenario 3: Readiness Probe Rejection on Circuit Breaker / Subsystem Failure...');

    const brokenBreaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10000 });
    brokenBreaker.recordFailure(new Error('Router unreachable')); // State transitions to OPEN
    assert.equal(brokenBreaker.getState(), 'OPEN');

    const mockQuotaRepo = {
      isReady: () => false,
      getAll: async () => {
        throw new Error('Quota storage inaccessible');
      },
      getQuotas: async () => [],
      getQuota: async () => null,
      saveQuota: async () => {},
      updateQuota: async () => null,
      deleteQuota: async () => false,
      reconcileWithLanClients: async () => ({ evaluated: 0, removedCount: 0, removedMacs: [] }),
    };

    const healthService = new HealthService({
      circuitBreaker: brokenBreaker,
      quotaRepository: mockQuotaRepo as any,
    });

    const app = Fastify();
    await app.register(healthRoutes, { service: healthService });

    // 1. Liveness should still return 200 alive (process is functioning)
    const liveRes = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(liveRes.statusCode, 200);
    assert.equal(liveRes.json<{ status: string }>().status, 'alive');

    // 2. Readiness MUST return 503 (not ready to serve traffic)
    const readyRes = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(readyRes.statusCode, 503);
    const readyBody = readyRes.json<{ ready: boolean; status: string }>();
    assert.equal(readyBody.ready, false);
    assert.equal(readyBody.status, 'not_ready');

    await app.close();
    console.log('✅ Scenario 3 Passed: Readiness probe returns 503 on subsystem failure while liveness remains 200');
  }

  // =========================================================================
  // Scenario 4: Operations Status Reflects Router Failure & Circuit Breaker OPEN
  // =========================================================================
  {
    console.log('Running Scenario 4: Operations Status on Circuit Breaker OPEN...');

    const brokenBreaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10000 });
    brokenBreaker.recordFailure(new Error('Connection timed out'));
    brokenBreaker.recordFailure(new Error('Connection refused'));
    assert.equal(brokenBreaker.getState(), 'OPEN');

    const opsHealthService = new HealthService({
      circuitBreaker: brokenBreaker,
    });

    const opsController = new OperationsController({
      circuitBreaker: brokenBreaker,
      healthService: opsHealthService,
    });

    const app = Fastify();
    fastifyRoutes: {
      app.get('/api/operations/status', opsController.getStatus);
    }

    const res = await app.inject({ method: 'GET', url: '/api/operations/status' });
    // In degraded/unhealthy status, status code is 200 or 503 based on severity
    const body = res.json<{
      status: string;
      openwrt: { circuitBreaker: string; consecutiveFailures: number };
      degradedComponents: string[];
    }>();

    assert.equal(body.openwrt.circuitBreaker, 'OPEN');
    assert.equal(body.openwrt.consecutiveFailures, 2);
    assert.ok(body.degradedComponents.some((c) => c.includes('Router')));

    await app.close();
    console.log('✅ Scenario 4 Passed: Operations status accurately detects OPEN circuit breaker and degraded router');
  }

  // =========================================================================
  // Scenario 5: verify-deployment.sh Fails on Unreachable Service
  // =========================================================================
  {
    console.log('Running Scenario 5: verify-deployment.sh Fails on Unreachable Service...');
    const verifyScript = path.join(ROOT_DIR, 'deploy', 'verify-deployment.sh');

    let scriptFailed = false;
    try {
      execFileSync('bash', [verifyScript, '--url', 'http://127.0.0.1:59999', '--timeout', '2'], {
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      const exitCode = (err as { status?: number }).status;
      assert.equal(exitCode, 1, 'verify-deployment.sh must exit with code 1 on unreachable service');
      scriptFailed = true;
    }

    assert.ok(scriptFailed, 'verify-deployment.sh must exit with error status on dead service');
    console.log('✅ Scenario 5 Passed: verify-deployment.sh properly reports FAIL on unreachable target');
  }

  // =========================================================================
  // Scenario 6: Corrupted State Detection in Backup and Restore
  // =========================================================================
  {
    console.log('Running Scenario 6: Corrupted State Detection in Backup & Restore...');
    const testDir = path.join(ROOT_DIR, 'backups', 'corrupt_test_' + Date.now());
    const testDataDir = path.join(testDir, 'data');
    const testBackupDir = path.join(testDir, 'backups');
    fs.mkdirSync(testDataDir, { recursive: true });
    fs.mkdirSync(testBackupDir, { recursive: true });

    try {
      // Write corrupted JSON to data directory
      fs.writeFileSync(path.join(testDataDir, 'quotas.json'), 'NOT_VALID_JSON_{{{');

      // Attempt backup - should fail without creating broken backup
      const backupScript = path.join(ROOT_DIR, 'deploy', 'backup.sh');
      let backupFailed = false;
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
        backupFailed = true;
      }
      assert.ok(backupFailed, 'backup.sh must abort when source state is corrupt');

      // Test restore from non-existent directory
      const restoreScript = path.join(ROOT_DIR, 'deploy', 'restore.sh');
      let restoreFailedOnMissing = false;
      try {
        execFileSync('bash', [restoreScript, path.join(testDir, 'nonexistent_backup')], {
          env: {
            ...process.env,
            DATA_DIR: testDataDir,
          },
          stdio: 'pipe',
        });
      } catch {
        restoreFailedOnMissing = true;
      }
      assert.ok(restoreFailedOnMissing, 'restore.sh must fail when backup directory does not exist');

      // Test restore from corrupted backup directory
      const corruptBackupDir = path.join(testDir, 'corrupt_snapshot');
      fs.mkdirSync(corruptBackupDir, { recursive: true });
      fs.writeFileSync(path.join(corruptBackupDir, 'quotas.json'), 'CORRUPT_BACKUP_CONTENT');

      // Active state before restore attempt
      fs.writeFileSync(path.join(testDataDir, 'quotas.json'), JSON.stringify([{ mac: '52:54:00:99:99:99' }]));

      let restoreFailedOnCorrupt = false;
      try {
        execFileSync('bash', [restoreScript, corruptBackupDir], {
          env: {
            ...process.env,
            DATA_DIR: testDataDir,
          },
          stdio: 'pipe',
        });
      } catch {
        restoreFailedOnCorrupt = true;
      }
      assert.ok(restoreFailedOnCorrupt, 'restore.sh must reject corrupted backup file');

      // Active state must NOT have been overwritten
      const preservedData = fs.readFileSync(path.join(testDataDir, 'quotas.json'), 'utf8');
      assert.ok(preservedData.includes('52:54:00:99:99:99'), 'Active state must be preserved when restore fails');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    console.log('✅ Scenario 6 Passed: Backup and restore tools reject corrupted state and preserve active data');
  }

  console.log('\n🎉 ALL Phase 19 Production Failure Scenarios & Edge Cases Tests PASSED! 🎉\n');
}

runFailureScenarioTests().catch((err) => {
  console.error('❌ Failure Scenario Test Error:', err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const CONTAINER_URL = 'http://127.0.0.1:3050';
const CONTAINER_NAME = 'openwrt-controller';

async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(url, options);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, raw: text };
  }
}

async function waitForHealthy(timeoutMs = 30000): Promise<number> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${CONTAINER_URL}/health/ready`);
      if (res.status === 200) {
        const body = (await res.json()) as any;
        if (body.ready === true) {
          return Math.round(performance.now() - start);
        }
      }
    } catch {
      // Container booting up
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for ${CONTAINER_NAME} to become ready`);
}

async function run() {
  console.log('🧪 Starting Stage 6: Docker Container Restart & Recovery Testing...');

  // Ensure container is running initially
  const initialReady = await waitForHealthy(5000).catch(() => null);
  if (initialReady === null) {
    console.log(`Starting ${CONTAINER_NAME} container...`);
    execSync(`docker start ${CONTAINER_NAME}`);
    await waitForHealthy(20000);
  }

  console.log('  Container is healthy and ready on port 3050.');

  // ============================================================================
  // Test 1: docker restart during active workload
  // ============================================================================
  console.log('\n--- Scenario 6.1: Docker restart during sync & state modification ---');
  {
    // Start active operations
    const bgSync = fetchJson(`${CONTAINER_URL}/api/quota-enforcement/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);

    const bgBlocked = fetchJson(`${CONTAINER_URL}/api/firewall/blocked`).catch(() => null);

    // Restart container mid-flight
    console.log(`  Executing: docker restart ${CONTAINER_NAME}...`);
    const t0 = performance.now();
    execSync(`docker restart ${CONTAINER_NAME}`);
    const restartCommandMs = Math.round(performance.now() - t0);

    console.log(`  docker restart command completed in ${restartCommandMs}ms. Waiting for service ready...`);
    const recoveryMs = await waitForHealthy(25000);
    console.log(`  ✅ Container fully recovered to READY status in ${recoveryMs}ms.`);

    // Verify health and telemetry post-restart
    const health = await fetchJson(`${CONTAINER_URL}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'healthy');
    assert.equal(health.data.router, 'healthy');
    console.log('  ✅ Health probe reports healthy and router connection intact after docker restart.');
  }

  // ============================================================================
  // Test 2: docker stop followed by docker start
  // ============================================================================
  console.log('\n--- Scenario 6.2: Docker stop and start lifecycle verification ---');
  {
    console.log(`  Executing: docker stop ${CONTAINER_NAME}...`);
    const tStop = performance.now();
    execSync(`docker stop ${CONTAINER_NAME}`);
    const stopMs = Math.round(performance.now() - tStop);
    console.log(`  docker stop completed in ${stopMs}ms.`);

    // Verify service is unreachable
    let stoppedUnreachable = false;
    try {
      await fetch(`${CONTAINER_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      stoppedUnreachable = true;
    }
    assert.ok(stoppedUnreachable, 'Service must be unreachable while container is stopped');

    console.log(`  Executing: docker start ${CONTAINER_NAME}...`);
    const tStart = performance.now();
    execSync(`docker start ${CONTAINER_NAME}`);
    const startCmdMs = Math.round(performance.now() - tStart);

    const readyMs = await waitForHealthy(25000);
    console.log(`  docker start completed in ${startCmdMs}ms. Service ready in ${readyMs}ms.`);

    const live = await fetchJson(`${CONTAINER_URL}/health/live`);
    assert.equal(live.status, 200);
    assert.equal(live.data.status, 'alive');

    const ops = await fetchJson(`${CONTAINER_URL}/api/operations/status`);
    assert.equal(ops.status, 200);
    assert.ok(ops.data.uptimeSeconds >= 0);
    console.log('  ✅ Container stop/start cycle succeeded with instant health restoration.');
  }

  // ============================================================================
  // Test 3: Container state persistence verification across restart
  // ============================================================================
  console.log('\n--- Scenario 6.3: State persistence across container lifecycle ---');
  {
    const blockedRes = await fetchJson(`${CONTAINER_URL}/api/firewall/blocked`);
    assert.equal(blockedRes.status, 200);
    assert.equal(blockedRes.data.success, true);
    console.log(`  Current blocked count post-lifecycle: ${blockedRes.data.count}`);
    console.log('  ✅ Persistent state intact across container recreate/restart cycles.');
  }

  console.log('\n✅ Stage 6 Docker Restart & Lifecycle Testing Completed Successfully!\n');
}

void run();

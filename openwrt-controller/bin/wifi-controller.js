#!/usr/bin/env node
// ==============================================================================
// OpenWrt WiFi Quota Manager - Operational CLI Tool
// ==============================================================================

import { APP_VERSION } from '../dist/version.js';

const DEFAULT_URL = process.env.CONTROLLER_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const DEFAULT_TIMEOUT_MS = 5000;

function printUsage() {
  console.log(`
OpenWrt WiFi Quota Controller CLI (v${APP_VERSION})

USAGE:
  wifi-controller <command> [options]

COMMANDS:
  status        Display overall controller health, version, uptime, and router state
  health        Check health endpoints (optional: --live, --ready)
  devices       List active connected client devices from OpenWrt router
  quotas        List configured device quotas and bandwidth consumption
  enforce       Trigger an immediate quota enforcement cycle
  reconcile     Trigger an immediate quota reconciliation cycle
  router        Inspect OpenWrt router connection & circuit breaker diagnostics
  metrics       Display Prometheus metrics or structured JSON metrics
  version       Print the controller application version

OPTIONS:
  -u, --url <url>      Controller base URL (default: ${DEFAULT_URL})
  -t, --token <token>  Admin API authorization token (or set API_AUTH_TOKEN)
  --json               Output machine-readable JSON
  --timeout <ms>       Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help           Show this help message

EXAMPLES:
  wifi-controller status
  wifi-controller health --ready
  wifi-controller quotas --json
  wifi-controller enforce --token <SECRET_TOKEN>
`);
}

function parseArgs(args) {
  const parsed = {
    command: null,
    url: DEFAULT_URL,
    token: process.env.API_AUTH_TOKEN || process.env.ADMIN_API_TOKEN || null,
    json: false,
    live: false,
    ready: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--live') {
      parsed.live = true;
    } else if (arg === '--ready') {
      parsed.ready = true;
    } else if ((arg === '-u' || arg === '--url') && i + 1 < args.length) {
      parsed.url = args[++i];
    } else if ((arg === '-t' || arg === '--token') && i + 1 < args.length) {
      parsed.token = args[++i];
    } else if (arg === '--timeout' && i + 1 < args.length) {
      parsed.timeoutMs = parseInt(args[++i], 10) || DEFAULT_TIMEOUT_MS;
    } else if (!arg.startsWith('-') && !parsed.command) {
      parsed.command = arg;
    }
  }

  // Normalize URL trailing slash
  parsed.url = parsed.url.replace(/\/+$/, '');
  return parsed;
}

async function request(baseUrl, endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: options.accept || 'application/json',
    ...(options.headers || {}),
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    return {
      status: res.status,
      ok: res.ok,
      data,
    };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms connecting to ${baseUrl}`);
    }
    throw new Error(`Connection failed: ${err.message}`);
  }
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || !options.command) {
    printUsage();
    process.exit(options.help ? 0 : 2);
  }

  try {
    switch (options.command) {
      case 'version': {
        if (options.json) {
          console.log(JSON.stringify({ version: APP_VERSION }));
        } else {
          console.log(`OpenWrt Controller Version: ${APP_VERSION}`);
        }
        break;
      }

      case 'status': {
        const { ok, status, data } = await request(options.url, '/api/operations/status', {
          token: options.token,
          timeoutMs: options.timeoutMs,
        });

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          process.exit(ok ? 0 : 1);
        }

        if (!ok) {
          console.error(`❌ Status check failed (${status}):`, data?.message || data);
          process.exit(1);
        }

        const color = data.status === 'healthy' ? '🟢' : data.status === 'degraded' ? '🟡' : '🔴';
        console.log(`\n${color} OpenWrt Controller: ${data.status.toUpperCase()} (v${data.controllerVersion})`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`  Uptime:             ${data.uptimeSeconds}s (${Math.floor(data.uptimeSeconds / 60)}m)`);
        console.log(`  Environment:        ${data.nodeEnv}`);
        console.log(`  Router Host:        ${data.openwrt.host}:${data.openwrt.port}`);
        console.log(`  Circuit Breaker:    ${data.openwrt.circuitBreaker} (Failures: ${data.openwrt.consecutiveFailures})`);
        console.log(`  Quota Monitor:      ${data.monitor.running ? 'RUNNING' : 'STOPPED'} (Interval: ${data.monitor.intervalMs}ms)`);
        console.log(`  Last Enforcement:   ${data.lastEnforcement.lastCompletedAt || 'Never'} (Success: ${data.lastEnforcement.success})`);
        console.log(`  HTTP Requests:      ${data.metricsSummary.httpRequestsTotal} (Errors: ${data.metricsSummary.httpErrorsTotal})`);
        console.log(`  SSH Operations:     ${data.metricsSummary.sshAttempts} (Failures: ${data.metricsSummary.sshFailures})`);
        console.log(`  Devices Blocked:    ${data.metricsSummary.devicesBlockedTotal}`);
        if (data.degradedComponents && data.degradedComponents.length > 0) {
          console.log(`  ⚠️ Degraded:        ${data.degradedComponents.join(', ')}`);
        }
        console.log('');
        break;
      }

      case 'health': {
        let endpoint = '/health';
        if (options.live) endpoint = '/health/live';
        if (options.ready) endpoint = '/health/ready';

        const { ok, status, data } = await request(options.url, endpoint, {
          token: options.token,
          timeoutMs: options.timeoutMs,
        });

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          process.exit(ok ? 0 : 1);
        }

        if (ok) {
          console.log(`✅ Health [${endpoint}]: OK (${status})`);
          if (data.subsystems) {
            console.log('Subsystems:');
            for (const [sub, info] of Object.entries(data.subsystems)) {
              console.log(`  - ${sub}: ${info.ready ? 'READY' : 'NOT READY'}`);
            }
          }
        } else {
          console.error(`❌ Health [${endpoint}] Failed (${status}):`, data);
          process.exit(1);
        }
        break;
      }

      case 'devices': {
        const { ok, status, data } = await request(options.url, '/api/devices', {
          token: options.token,
          timeoutMs: options.timeoutMs,
        });

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          process.exit(ok ? 0 : 1);
        }

        if (!ok) {
          console.error(`❌ Failed to retrieve devices (${status}):`, data?.message || data);
          process.exit(1);
        }

        const devices = Array.isArray(data) ? data : (data.devices || []);
        console.log(`\n📱 Connected Devices (${devices.length})`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        if (devices.length === 0) {
          console.log('  No devices currently active on router.');
        } else {
          for (const d of devices) {
            console.log(`  • MAC: ${d.mac.padEnd(18)} IP: ${(d.ip || 'N/A').padEnd(16)} Hostname: ${d.hostname || 'Unknown'}`);
          }
        }
        console.log('');
        break;
      }

      case 'quotas': {
        const { ok, status, data } = await request(options.url, '/api/quotas', {
          token: options.token,
          timeoutMs: options.timeoutMs,
        });

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          process.exit(ok ? 0 : 1);
        }

        if (!ok) {
          console.error(`❌ Failed to retrieve quotas (${status}):`, data?.message || data);
          process.exit(1);
        }

        const quotas = Array.isArray(data) ? data : (data.quotas || []);
        console.log(`\n⚖️  Configured Quotas (${quotas.length})`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        if (quotas.length === 0) {
          console.log('  No quotas configured.');
        } else {
          for (const q of quotas) {
            const statusIcon = q.status === 'active' ? '🟢' : '🔴';
            console.log(
              `  ${statusIcon} MAC: ${q.mac.padEnd(18)} Limit: ${formatBytes(q.quotaBytes).padEnd(10)} ` +
              `Used: ${formatBytes(q.usedBytes).padEnd(10)} (${q.percentage}%) Status: ${q.status.toUpperCase()}`
            );
          }
        }
        console.log('');
        break;
      }

      case 'enforce':
      case 'reconcile': {
        const { ok, status, data } = await request(options.url, '/api/quota-enforcement/sync', {
          method: 'POST',
          token: options.token,
          timeoutMs: options.timeoutMs,
        });

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          process.exit(ok ? 0 : 1);
        }

        if (ok) {
          console.log(`\n✅ Quota enforcement/reconciliation triggered successfully!`);
          console.log(`  Running:         ${data.running}`);
          console.log(`  Last Run:        ${data.lastRunAt}`);
          console.log(`  Duration:        ${data.lastRunDurationMs}ms`);
          console.log(`  Devices Eval:    ${data.devicesEvaluated ?? 'N/A'}`);
          console.log(`  Devices Blocked: ${data.devicesBlocked ?? 0}`);
        } else {
          console.error(`❌ Enforcement failed (${status}):`, data?.message || data);
          process.exit(1);
        }
        break;
      }

      case 'router': {
        const { ok, status, data } = await request(options.url, '/api/operations/status', {
          token: options.token,
          timeoutMs: options.timeoutMs,
        });

        if (options.json) {
          console.log(JSON.stringify(data?.openwrt || {}, null, 2));
          process.exit(ok ? 0 : 1);
        }

        if (!ok) {
          console.error(`❌ Failed to retrieve router diagnostics (${status}):`, data?.message || data);
          process.exit(1);
        }

        const ow = data.openwrt;
        console.log(`\n📡 OpenWrt Router Diagnostics`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`  Target:             ${ow.host}:${ow.port}`);
        console.log(`  Circuit Breaker:    ${ow.circuitBreaker}`);
        console.log(`  Consecutive Errors: ${ow.consecutiveFailures}`);
        console.log(`  Last Success:       ${ow.lastSuccessTime || 'None'}`);
        console.log(`  Last Failure:       ${ow.lastFailureTime || 'None'}`);
        console.log(`  SSH Total Calls:    ${data.metricsSummary.sshAttempts}`);
        console.log(`  SSH Total Failures: ${data.metricsSummary.sshFailures}`);
        console.log('');
        break;
      }

      case 'metrics': {
        if (options.json) {
          const { ok, status, data } = await request(options.url, '/api/metrics', {
            token: options.token,
            timeoutMs: options.timeoutMs,
          });
          console.log(JSON.stringify(data, null, 2));
          process.exit(ok ? 0 : 1);
        } else {
          const { ok, status, data } = await request(options.url, '/metrics', {
            accept: 'text/plain',
            token: options.token,
            timeoutMs: options.timeoutMs,
          });
          if (ok) {
            console.log(data);
          } else {
            console.error(`❌ Failed to retrieve metrics (${status}):`, data);
            process.exit(1);
          }
        }
        break;
      }

      default: {
        console.error(`❌ Unknown command: "${options.command}". Run "wifi-controller --help" for available commands.`);
        process.exit(2);
      }
    }
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ error: err.message, success: false }));
    } else {
      console.error(`❌ Error: ${err.message}`);
    }
    process.exit(1);
  }
}

main();

# Phase 18 — Production Observability & Operations Guide

## 1. Architecture Overview

Phase 18 introduces an enterprise-grade Observability and Operations layer to `openwrt-controller`. The architecture is designed around non-blocking, zero-overhead abstractions that integrate cleanly into Fastify without introducing unnecessary dependencies or modifying core router security invariants.

```
                      +----------------------------------------------+
                      |               Fastify Server                 |
                      |                                              |
                      |  +----------------+      +----------------+  |
                      |  | Request Hook   | ---> | MetricsService |  |
                      |  | (X-Request-Id) |      | (Prometheus &  |  |
                      |  +----------------+      |  JSON Store)   |  |
                      |                          +-------+--------+  |
                      |                                  ^           |
                      |                                  |           |
                      |  +--------------------+          |           |
                      |  | QuotaEnforcement   |----------+           |
                      |  | Monitor & Lock     |          |           |
                      |  +---------+----------+          |           |
                      |            |                     |           |
                      |  +---------v----------+          |           |
                      |  | SshClient & Ubus   |----------+           |
                      |  | & Circuit Breaker  |                      |
                      |  +---------+----------+                      |
                      +------------|---------------------------------+
                                   | SSH (Strict Key & Guarded)
                                   v
             +---------------------------------------------+
             |            OpenWrt Router                   |
             |                                             |
             |  table inet fw4              (UNTOUCHED)    |
             |  table inet quota_enforcement               |
             |    set blocked_macs                         |
             |    chain forward_block                      |
             +---------------------------------------------+
```

### Core Invariants Maintained:
- **Router Firewall Isolation**: The native OpenWrt firewall (`table inet fw4`) remains untouched. All project firewall blocks reside strictly within `table inet quota_enforcement`.
- **Zero Secret Leakage**: No SSH private keys, passwords, API tokens, or raw stderr containing sensitive parameters are ever exposed via logs, metrics, or API endpoints.
- **Concurrency & Overlapping Protection**: Re-entrant enforcement cycles are strictly guarded by `syncInProgress`. If cycle $N$ is running, cycle $N+1$ safely logs and skips without clobbering state.

---

## 2. Production Metrics System

Metrics are managed centrally via `MetricsService` (`src/infrastructure/metrics/MetricsService.ts`), an in-memory, thread-safe, typed registry supporting both Prometheus text format (`text/plain; version=0.0.4`) and structured JSON.

### Endpoints:
- `GET /metrics`: Standard Prometheus scraping endpoint.
- `GET /api/metrics`: JSON categorized payload for administration dashboards and automated monitoring tools.

### Tracked Metrics Inventory:

| Metric Name | Type | Labels | Description |
|:---|:---|:---|:---|
| `http_requests_total` | Counter | `method`, `route`, `status` | Total HTTP requests handled |
| `http_errors_total` | Counter | `status_code` | HTTP error count (4xx and 5xx) |
| `http_request_duration_seconds` | Histogram | `method`, `route` | Latency distribution of HTTP requests |
| `http_active_requests` | Gauge | - | Current number of concurrently running requests |
| `openwrt_ssh_attempts_total` | Counter | - | Total SSH connection attempts |
| `openwrt_ssh_successes_total` | Counter | - | Total successful SSH commands executed |
| `openwrt_ssh_failures_total` | Counter | - | Total SSH execution failures |
| `openwrt_ssh_duration_seconds` | Histogram | `operation` | Execution latency of SSH commands |
| `openwrt_ubus_calls_total` | Counter | `method` | Total OpenWrt ubus calls executed |
| `openwrt_ubus_failures_total` | Counter | - | Total failed ubus invocations |
| `openwrt_nftables_operations_total` | Counter | `operation` | Total nftables operations (block, unblock, ensure, flush) |
| `openwrt_nftables_failures_total` | Counter | - | Total failed nftables operations |
| `quota_total_records` | Gauge | - | Total quota definitions managed |
| `quota_active_records` | Gauge | - | Quotas currently in `active` state |
| `quota_exhausted_records` | Gauge | - | Quotas that have reached or exceeded limit |
| `quota_blocked_devices` | Gauge | - | Devices currently blocked in firewall |
| `quota_enforcement_cycles_total` | Counter | - | Total quota evaluation cycles executed |
| `quota_enforcement_cycle_duration_seconds` | Histogram | - | Duration distribution of enforcement cycles |
| `quota_enforcement_actions_total` | Counter | `action` (`block`, `unblock`) | Successful firewall enforcement actions applied |
| `quota_enforcement_failures_total` | Counter | `action` | Failed firewall enforcement actions |
| `quota_reconciliation_cycles_total` | Counter | - | Total reconciliation runs |
| `quota_reconciliation_failures_total` | Counter | - | Reconciliation runs that encountered errors |
| `resilience_retry_attempts_total` | Counter | `operation` | Operations retried by RetryPolicy |
| `resilience_retry_exhausted_total` | Counter | `operation` | Operations where retry attempts were exhausted |
| `resilience_circuit_breaker_state` | Gauge | `state` (`0=CLOSED`, `1=HALF_OPEN`, `2=OPEN`) | Current Circuit Breaker state |
| `resilience_circuit_breaker_opens_total` | Counter | - | Count of transitions to OPEN state |
| `resilience_circuit_breaker_probes_total` | Counter | - | Count of trial probes in HALF_OPEN state |
| `resilience_circuit_breaker_closes_total` | Counter | - | Count of recoveries back to CLOSED state |
| `process_uptime_seconds` | Gauge | - | Process uptime in seconds |
| `process_memory_rss_bytes` | Gauge | - | Resident Set Size memory usage |
| `process_memory_heap_used_bytes` | Gauge | - | Heap memory used |
| `process_memory_heap_total_bytes` | Gauge | - | Total allocated heap memory |
| `process_graceful_shutdowns_total` | Counter | - | Graceful shutdown invocations |

---

## 3. Health vs. Readiness Architecture

Phase 18 logically separates process liveness from operational readiness.

### 3.1 Liveness (`GET /health/live` & `GET /api/health/live`)
- **Purpose**: Kubernetes or process supervisor probe to verify that the Node.js event loop is alive and HTTP server is processing requests.
- **Status Codes**: Always returns `200 OK` if the process is responsive.
- **Payload**:
  ```json
  {
    "status": "alive",
    "service": "openwrt-controller",
    "timestamp": "2026-09-28T16:42:00.277Z",
    "uptimeSeconds": 42,
    "pid": 705271,
    "memoryUsage": {
      "rssBytes": 114241536,
      "heapUsedBytes": 26223992,
      "heapTotalBytes": 58634240
    }
  }
  ```

### 3.2 Readiness (`GET /health/ready` & `GET /api/health/ready`)
- **Purpose**: Load balancer / ingress probe to verify whether the controller is ready to execute traffic and business operations.
- **Criteria Evaluated**:
  1. `quotaStorage`: Verifies quota repository filesystem is accessible.
  2. `routerConnectivity`: Evaluates Circuit Breaker state (`CLOSED` = ready, `OPEN` = not ready).
  3. `firewall`: Verifies firewall subsystem readiness.
  4. `monitor`: Verifies quota enforcement monitor status (`running`).
- **Status Determination**:
  - `ready: true` (HTTP 200): All critical subsystems healthy.
  - `status: "degraded"` (HTTP 200): Non-critical warnings present (e.g. consecutive router probe errors under threshold), but system still operating.
  - `ready: false` (HTTP 503): Critical subsystem down (e.g. storage failure or Circuit Breaker tripped OPEN).

### 3.3 Legacy Endpoint (`GET /api/health`)
- Maintained for backwards compatibility with existing clients and CLI tools, combining overall service health with subsystem diagnostics.

---

## 4. Structured Logging & Request Correlation

### Correlation Identifier (`X-Request-Id`):
- Every incoming HTTP request is assigned a unique UUID `reqId`.
- Propagated through:
  - Incoming request log entry.
  - Downstream service logger context via `logger.withModule()`.
  - HTTP response header `X-Request-Id`.
  - Error responses formatted for client diagnostics.

### Structured Production Logger (`src/infrastructure/logging/Logger.ts`):
- Outputs single-line JSON entries.
- Fields included:
  - `timestamp`: ISO-8601 UTC.
  - `level`: `debug` | `info` | `warn` | `error`.
  - `module`: Subsystem identifier (e.g., `resilience`, `firewall`, `monitor`).
  - `event`: Discrete lifecycle event name (e.g., `circuit_breaker_opened`, `reconciliation_completed`).
  - `durationMs`: High-precision duration tracked via `startTimer()`.
  - `status` / `success`: Operational outcome.
  - `error`: Error message sanitized to redact passwords, private keys, or command tokens.

---

## 5. Graceful Shutdown & Resource Draining

The shutdown engine (`src/infrastructure/shutdown/GracefulShutdown.ts`) coordinates clean process exit upon `SIGTERM` or `SIGINT`:

1. **Stop Accepting New Ingress**: Closes HTTP server listeners.
2. **Stop Background Periodic Tasks**: Stops `QuotaEnforcementMonitor` interval timer.
3. **Drain Active Operations**: Waits for any in-flight quota reconciliation cycle to complete.
4. **Shutdown Timeout Guard**: Controlled by `SHUTDOWN_TIMEOUT_MS` (default: 5000ms). If active tasks do not drain within the timeout, force-exits to avoid hanging containers.
5. **Telemetry & Exit**: Increments `process_graceful_shutdowns_total` metric, logs shutdown reason, and exits with code 0.

---

## 6. Operational Status Endpoint (`GET /api/operations/status`)

Provides a comprehensive operational snapshot without exposing credentials:

```json
{
  "status": "healthy",
  "timestamp": "2026-09-28T16:42:00.314Z",
  "uptimeSeconds": 38,
  "controllerVersion": "1.0.0",
  "nodeEnv": "development",
  "openwrt": {
    "host": "192.168.50.1",
    "port": 22,
    "circuitBreaker": "CLOSED",
    "consecutiveFailures": 0,
    "lastFailureTime": null,
    "lastSuccessTime": "2026-09-28T16:41:59.457Z"
  },
  "monitor": {
    "running": true,
    "syncInProgress": false,
    "intervalMs": 5000,
    "enabled": true,
    "lastRunAt": "2026-09-28T16:41:58.561Z",
    "lastRunDurationMs": 945,
    "lastRunSuccess": true,
    "totalRuns": 8,
    "consecutiveErrors": 0
  },
  "lastEnforcement": {
    "reconciliationId": "4a55b161-2c57-45d1-87da-f750fc5b002a",
    "lastStartedAt": "2026-09-28T16:41:58.561Z",
    "lastCompletedAt": "2026-09-28T16:41:59.457Z",
    "lastSuccessfulAt": "2026-09-28T16:41:59.457Z",
    "lastFailureAt": null,
    "durationMs": 945,
    "devicesEvaluated": 1,
    "devicesBlocked": 0,
    "devicesUnblocked": 0,
    "success": true
  },
  "metricsSummary": {
    "httpRequestsTotal": 63,
    "httpErrorsTotal": 0,
    "sshAttempts": 113,
    "sshFailures": 0,
    "enforcementCycles": 8,
    "circuitBreakerOpens": 0,
    "devicesBlockedTotal": 0,
    "devicesUnblockedTotal": 0
  },
  "degradedComponents": []
}
```

---

## 7. Troubleshooting Guide

### Issue 1: HTTP 503 on `/health/ready`
- **Symptom**: Load balancer takes controller out of rotation.
- **Cause**: OpenWrt router unreachable via SSH, causing Circuit Breaker to trip `OPEN`.
- **Diagnosis**:
  1. Inspect `curl -s http://127.0.0.1:3001/api/operations/status | jq .openwrt`.
  2. Check circuit breaker state: if `"OPEN"`, check router connectivity.
  3. Verify SSH connection manually from host: `ssh root@192.168.50.1`.
- **Resolution**:
  - Once router network connectivity is restored, the circuit breaker automatically moves to `HALF_OPEN` after `RESET_TIMEOUT_MS` (default: 30s), probes the router, and recovers to `CLOSED`.

### Issue 2: Rate Limit 429 Errors on API
- **Symptom**: Administrative requests or automation tools receive `429 Too Many Requests`.
- **Cause**: Phase 17 rate limiter (`RATE_LIMIT_MAX_REQUESTS` per minute).
- **Resolution**: Adjust `RATE_LIMIT_MAX_REQUESTS` in `.env` if legitimate automated dashboards require higher request frequency.

### Issue 3: Quota Enforcement Cycle Skipped
- **Symptom**: Log contains `Previous quota enforcement cycle is still in progress; skipping overlapping run`.
- **Cause**: SSH latency to router momentarily exceeded the enforcement interval (`5000ms`).
- **Resolution**: This is normal protective behavior. The overlapping lock ensures state integrity and will execute immediately on the next interval once the router responds.

---

## 8. Failure Scenarios & Self-Healing

1. **Router Reboot / Kernel State Loss**:
   - The router reboots and its in-memory nftables state resets.
   - On the next enforcement cycle, `QuotaEnforcementMonitor` detects that the router table or set is missing or empty compared to persistent storage.
   - It automatically rebuilds `table inet quota_enforcement` and re-applies all active blocks (verified in Phase 18 tests).
2. **Partial Device Failure**:
   - If an error occurs when blocking Device A (e.g., malformed lock), the error is caught and isolated.
   - Device B and Device C continue to be processed and blocked normally.
   - `quota_enforcement_failures_total{action="block"}` is incremented.
3. **Controller Process Restart**:
   - Upon restart, the controller reads persisted quota files from `data/quotas/`, synchronizes with router usage counters, and reconciles state without duplicating nftables elements.

---

## 9. Production Deployment Notes

1. **Environment Variables**:
   - `PORT`: Set to desired port (default: `3001`).
   - `HOST`: Set to `0.0.0.0` or internal interface IP.
   - `SHUTDOWN_TIMEOUT_MS`: Set to `5000` (or `10000` for slow networks).
   - `NODE_ENV`: Must be set to `production` in production environments.
2. **Log Rotation**:
   - The controller outputs structured JSON directly to `stdout`/`stderr`.
   - In production, log collection and rotation must be handled by `journald`, `logrotate`, Docker log driver (`json-file` with `max-size=50m`, `max-file=5`), or a sidecar agent (e.g. Promtail, Fluentbit).
3. **Process Supervision**:
   - Run under `systemd` or Docker container with `restart: always`.

---

## 10. Prometheus & Alerting Recommendations

### Recommended Prometheus Scrape Config:
```yaml
scrape_configs:
  - job_name: 'openwrt-controller'
    scrape_interval: 15s
    scrape_timeout: 5s
    static_configs:
      - targets: ['127.0.0.1:3001']
    metrics_path: '/metrics'
```

### Critical Alert Rules:
- **CircuitBreakerTripped**:
  `resilience_circuit_breaker_state{state="2"} > 0`
  *Severity*: Critical. OpenWrt router is unreachable.
- **RouterSshFailuresSpike**:
  `increase(openwrt_ssh_failures_total[5m]) > 5`
  *Severity*: Warning. SSH connection degrading.
- **QuotaReconciliationFailing**:
  `increase(quota_reconciliation_failures_total[10m]) > 2`
  *Severity*: High. Quota firewall state may be desynchronized.
- **HighEventLoopLagOrMemory**:
  `process_memory_rss_bytes > 500000000`
  *Severity*: Warning. Resident memory exceeding 500MB.

---

## 11. Verification & Inspection Commands

```bash
# 1. Check Liveness Probe
curl -i http://127.0.0.1:3001/health/live

# 2. Check Readiness Probe
curl -i http://127.0.0.1:3001/health/ready

# 3. Scrape Prometheus Metrics
curl -s http://127.0.0.1:3001/metrics | head -n 30

# 4. View JSON Categorized Metrics
curl -s http://127.0.0.1:3001/api/metrics | jq .metrics

# 5. Check Operations & Subsystems Status
curl -s http://127.0.0.1:3001/api/operations/status | jq .

# 6. Verify Router Firewall Isolation
ssh root@192.168.50.1 "nft list table inet fw4 >/dev/null && echo 'fw4 intact'"
ssh root@192.168.50.1 "nft list table inet quota_enforcement"

# 7. Run Comprehensive Integration Test
./verify-openwrt-integration.sh
```

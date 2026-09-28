# Phase 19: Production Deployment, Packaging & Operational Tooling

## Overview

Phase 19 delivers an enterprise-grade, reproducible, and verifiable production operations layer for the OpenWrt WiFi Quota Manager Backend Controller (`openwrt-controller`).

This release provides:
* **Multi-stage, minimal Docker container** with non-root security (`node:node`), healthcheck, and `openssh-client`.
* **Hardened systemd service unit** (`openwrt-controller.service`) with strict sandboxing, private temporary filesystems, resource limits, and `journald` logging.
* **Production configuration management** with strict startup validation, zero-insecure defaults, and explicit CORS protection.
* **Prometheus monitoring & alerting configuration** (`deploy/prometheus/prometheus.yml`, `alerts.yml`) grounded directly on the controller's existing metric registry.
* **Production Grafana dashboard** (`deploy/grafana/openwrt-controller-dashboard.json`) visualizing HTTP rates, OpenWrt router status, circuit breaker states, and quota cycles.
* **Lightweight administrative CLI tool** (`wifi-controller`) communicating with the existing HTTP API without duplicating domain logic.
* **Automated deployment, verification, backup, restore, and rollback tooling** (`deploy.sh`, `verify-deployment.sh`, `backup.sh`, `restore.sh`, `rollback.sh`).
* **Single source of truth for versioning** (`src/version.ts`) propagated through API telemetry, logs, and CLI.

---

## 1. System Architecture

```text
                                 ┌──────────────────────┐
                                 │    Flutter Client    │
                                 └──────────┬───────────┘
                                            │
                                            ▼
                                 ┌──────────────────────┐
                                 │   Fastify Controller │
                                 │   v1.0.0 (Port 3000) │
                                 └──────────┬───────────┘
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  ▼                         ▼                         ▼
         Quota Enforcement          OpenWrt Router               Operations
       Periodic / Manual Sync       (SSH / ubus / nft)         Health / Readiness
                  │                         │                         │
                  └─────────────────────────┼─────────────────────────┘
                                            ▼
                                  Observability Engine
                             Pino Logs / Metrics / Health
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  ▼                         ▼                         ▼
             Prometheus                  Grafana                   CLI Tool
          /metrics Scrape               Dashboard              wifi-controller
                                            
────────────────────────────────────────────────────────────────────────────────
Deployment & Packaging Layer:
  • Docker: Multi-stage, Alpine-based, non-root user (node), container healthcheck
  • systemd: Dedicated user, NoNewPrivileges, ProtectSystem=strict, PrivateTmp
  • Backups: Atomic state snapshots with metadata & SHA256 integrity verification
  • Deployment: Validation → Backup → Build → Start → Probe → Verify → Keep/Rollback
────────────────────────────────────────────────────────────────────────────────
```

---

## 2. Production Prerequisites

* **Operating System**: Linux (Ubuntu 22.04+, Debian 12+, Alpine Linux, or similar systemd/container-compatible distribution).
* **Node.js**: v20 LTS or v22 LTS (ESM module support).
* **OpenSSH Client**: `ssh` installed on host or container image (configured with batch mode and strict host key checks).
* **OpenWrt Router**: OpenWrt 22.03+ / 23.05+ with `nlbwmon`, `nftables` (`fw4`), and `ubus` RPC enabled.

---

## 3. Configuration Management

Configuration is handled via environment variables and loaded via `src/config/env.ts` using strict Zod schemas.

### Environment Templates

* Development: `.env.example`
* Production: `.env.production.example`

### Core Environment Variables

| Variable | Type | Default | Production Requirement | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | `string` | `development` | `production` | Active runtime mode |
| `HOST` | `string` | `0.0.0.0` | `0.0.0.0` | Server bind host address |
| `PORT` | `number` | `3000` | `3000` | HTTP listening port |
| `CORS_ORIGIN` | `string` | `*` | **Explicit URL(s)** | Prohibited from using `*` in production |
| `API_AUTH_TOKEN` | `string` | *optional* | **Mandatory (>=16 chars)** | Admin bearer token for write operations |
| `OPENWRT_HOST` | `string` | *none* | **Mandatory** | OpenWrt router IP address |
| `OPENWRT_PORT` | `number` | `80` | `80` (or `443`) | ubus HTTP/HTTPS RPC port |
| `OPENWRT_USERNAME` | `string` | `root` | `root` | ubus administrative account |
| `OPENWRT_PASSWORD` | `string` | *none* | Required if no SSH key | ubus/router access password |
| `OPENWRT_SSH_PORT` | `number` | `22` | `22` | Router SSH daemon port |
| `OPENWRT_SSH_USER` | `string` | `root` | `root` | Router SSH user |
| `OPENWRT_SSH_KEY_PATH` | `string` | *optional* | Recommended | Private key path for passwordless SSH |
| `QUOTA_STORAGE_PATH` | `string` | `data/quotas.json` | Persistent path | File storage for quotas |
| `FIREWALL_STORAGE_PATH` | `string` | `data/firewall-blocks.json` | Persistent path | File storage for firewall blocks |
| `QUOTA_ENFORCEMENT_ENABLED` | `boolean` | `true` | `true` | Enable background monitor |
| `QUOTA_ENFORCEMENT_INTERVAL_MS`| `number` | `5000` | `>= 1000` | Cycle sync interval in ms |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD`| `number`| `3` | `>= 1` | Failure count to open breaker |
| `CIRCUIT_BREAKER_COOLDOWN_MS` | `number` | `10000` | `>= 1000` | Cooldown period before half-open probe |
| `SHUTDOWN_TIMEOUT_MS` | `number` | `5000` | `>= 500` | Graceful shutdown timeout in ms |

---

## 4. Docker Deployment

### Multi-Stage Build

The container build uses a multi-stage Dockerfile located at `Dockerfile`:

1. **Stage 1 (`builder`)**: Installs all dependencies including `devDependencies` to compile TypeScript via `tsc`.
2. **Stage 2 (`runner`)**: Uses `node:22-alpine`, installs `openssh-client`, installs only production dependencies (`npm ci --omit=dev`), sets up persistent `data/` and `.ssh/` directories, drops root privileges to user `node` (UID 1000), and defines a native container healthcheck against `/health/live`.

### Building and Running Manually

```bash
# Build production image
docker build -t openwrt-controller:1.0.0 -t openwrt-controller:latest .

# Run container with volume mount for persistent quota data
docker run -d \
  --name openwrt-controller \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env.production \
  -v $(pwd)/data:/app/data \
  openwrt-controller:latest
```

### Docker Compose

A production Docker Compose configuration is available at `deploy/docker/docker-compose.yml`:

```bash
cd deploy/docker
docker compose up -d
```

### Container Healthcheck

The container definition includes an embedded healthcheck polling `/health/live` every 15 seconds:

```dockerfile
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
```

---

## 5. Systemd Service Deployment

A production unit file is provided at `deploy/systemd/openwrt-controller.service`.

### Security Sandbox Features

* Dedicated non-root service user: `User=openwrt`, `Group=openwrt`.
* `NoNewPrivileges=true`: Disallows child processes from gaining elevated permissions.
* `ProtectSystem=strict`: Mounts `/usr`, `/boot`, `/etc` as read-only.
* `ProtectHome=read-only`: Disallows unauthorized home directory writes.
* `ReadWritePaths=/opt/openwrt-controller/data /var/log`: Restricts write access exclusively to data and log folders.
* `PrivateTmp=true`: Isolate temporary directories.
* `Restart=always`, `RestartSec=5s`: Immediate automatic restart upon unexpected failure.
* `KillSignal=SIGTERM`, `TimeoutStopSec=15s`: Triggers graceful shutdown hook.

### Installation

Use the automated installer:

```bash
sudo ./deploy/systemd/install-service.sh
sudo systemctl enable openwrt-controller
sudo systemctl start openwrt-controller
sudo systemctl status openwrt-controller
```

---

## 6. Operational Logging

* **Systemd**: Standard output and error stream directly into `journald`.
  ```bash
  # View live structured JSON logs
  sudo journalctl -u openwrt-controller -f

  # Query error events with jq
  sudo journalctl -u openwrt-controller -o cat | jq 'select(.level >= 40)'
  ```
* **Docker**: Output streams to Docker JSON log driver with log rotation configured (max 20MB per file, 5 files).
  ```bash
  docker logs -f openwrt-controller
  ```
* **Secret Redaction**: Passwords, tokens, cookies, and authorization headers are automatically redacted with `[REDACTED]`.

---

## 7. Prometheus Monitoring & Alerting

### Prometheus Scrape Configuration (`deploy/prometheus/prometheus.yml`)

```yaml
global:
  scrape_interval: 10s
  evaluation_interval: 10s

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: "openwrt-controller"
    metrics_path: "/metrics"
    static_configs:
      - targets: ["openwrt-controller:3000", "localhost:3000"]
```

### Alerts Configuration (`deploy/prometheus/alerts.yml`)

Configured alerts utilize genuine controller metrics:

1. `OpenWrtControllerDown`: Triggers if instance is down (`up == 0` for 1m).
2. `HighHttpErrorRate`: Triggers on elevated 4xx/5xx responses (`http_errors_total`).
3. `HighActiveHttpRequests`: Triggers if in-flight requests exceed 50 (`http_active_requests`).
4. `OpenWrtCircuitBreakerOpen`: Triggers when breaker trips (`resilience_circuit_breaker_state == 2` for 30s).
5. `OpenWrtSshFailuresSpike`: Triggers when router SSH operations fail (`openwrt_ssh_failures_total`).
6. `OpenWrtUbusFailuresSpike`: Triggers when ubus calls fail (`openwrt_ubus_failures_total`).
7. `OpenWrtNftablesFailuresSpike`: Triggers on firewall rule failures (`openwrt_nftables_failures_total`).
8. `QuotaEnforcementCycleFailures`: Triggers on monitor errors (`quota_enforcement_failures_total`).
9. `QuotaReconciliationFailures`: Triggers on firewall sync failures (`quota_reconciliation_failures_total`).
10. `HighMemoryUsage`: Triggers if RSS memory exceeds 400MB (`process_memory_rss_bytes`).
11. `HighEventLoopLag`: Triggers if event loop lag exceeds 100ms (`process_event_loop_lag_ms`).

---

## 8. Grafana Dashboard

A production Grafana template is available at `deploy/grafana/openwrt-controller-dashboard.json`.

### Dashboard Panels

* **Controller Overview**: Status (UP/DOWN), Uptime, Circuit Breaker State (CLOSED/HALF_OPEN/OPEN), Active Requests, RSS & Heap Memory.
* **HTTP Traffic & Performance**: Request rate (req/s), HTTP Error rate (errors/s).
* **OpenWrt Router Health**: SSH operations & failures/sec, ubus & nftables operation rates.
* **Quota Management**: Total, active, and exhausted quotas, blocked devices count, and periodic enforcement/reconciliation cycle rates.

---

## 9. Administrative Operational CLI (`wifi-controller`)

The operational CLI binary is located at `bin/wifi-controller.js` and registered in `package.json` under `"bin"`.

### Command Reference

```bash
# Check overall status and telemetry
wifi-controller status

# Check liveness and readiness probes
wifi-controller health
wifi-controller health --live
wifi-controller health --ready

# List active LAN devices discovered on router
wifi-controller devices

# List configured device quotas and usage
wifi-controller quotas

# Inspect router connection and circuit breaker diagnostics
wifi-controller router

# Trigger an immediate quota enforcement cycle
wifi-controller enforce --token <API_AUTH_TOKEN>

# Trigger an immediate reconciliation cycle
wifi-controller reconcile --token <API_AUTH_TOKEN>

# Fetch Prometheus metrics or JSON metrics
wifi-controller metrics
wifi-controller metrics --json

# Print controller version
wifi-controller version
wifi-controller version --json
```

### Global CLI Flags

* `-u, --url <url>`: Target controller base URL (default: `http://127.0.0.1:3000` or `$CONTROLLER_URL`).
* `-t, --token <token>`: Administrative bearer authorization token (or `$API_AUTH_TOKEN`).
* `--json`: Output raw machine-readable JSON.
* `--timeout <ms>`: Network request timeout in milliseconds (default: 5000ms).
* `-h, --help`: Display command usage help.

---

## 10. Operational Deployment Workflow

The production deployment orchestrator is located at `deploy/deploy.sh`.

```text
    Start Deployment (deploy/deploy.sh [local|docker|systemd])
                         │
                         ▼
        1. Validate Environment Configuration
                         │
                         ▼
        2. Validate Application Release Version
                         │
                         ▼
        3. Create Pre-Deployment State Backup (deploy/backup.sh)
                         │
                         ▼
        4. Compile TypeScript & Build Production Image
                         │
                         ▼
        5. Activate Release (Docker container / systemd service)
                         │
                         ▼
        6. Await Liveness (/health/live) & Readiness (/health/ready)
                         │
                         ▼
        7. Execute Smoke Test Suite (deploy/verify-deployment.sh)
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
        SUCCESS                     FAILURE
           │                           │
           ▼                           ▼
    Complete Release           Automatic Rollback (deploy/rollback.sh)
    Keep Production Live       Restore State & Restart Previous Version
```

### Executing Deployment

```bash
# Deploy via Docker
./deploy/deploy.sh docker

# Deploy via Systemd
./deploy/deploy.sh systemd
```

---

## 11. State Backup and Recovery

### State Components

The controller's persistent state resides strictly within the `data/` directory:
1. `data/quotas.json`: Configured device quotas and bandwidth accumulation.
2. `data/firewall-blocks.json`: Persisted administrative manual blocks and active quota blocks.

### Performing a Backup

```bash
./deploy/backup.sh
```
* Generates a timestamped directory in `backups/backup_<YYYYMMDD_HHMMSS>_<PID>/`.
* Validates JSON syntax prior to writing.
* Generates `metadata.json` with SHA256 checksums of all backed up files.
* Updates the symlink `backups/latest`.

### Restoring State

```bash
# Restore from latest backup
./deploy/restore.sh

# Restore from a specific backup
./deploy/restore.sh backups/backup_20260928_180120_798900
```
* Pre-validates backup files before modifying active data.
* Restores files atomically via temporary staging.
* Re-validates active files post-restoration.

---

## 12. Automated Verification

Phase 19 verification was completed against both local processes, containers, and live OpenWrt hardware:

```bash
# 1. TypeScript Build
npm run build
# Result: PASS (0 errors)

# 2. Automated Test Suite (33 test suites)
npm test
# Result: PASS (33/33 test suites passed)

# 3. Live OpenWrt Integration Verification
./verify-openwrt-integration.sh
# Result: PASS (26/26 checks passed against router 192.168.50.1)

# 4. Production Deployment Verification
./deploy/verify-deployment.sh --url http://127.0.0.1:3000
# Result: PASS (9/9 checks passed)
```

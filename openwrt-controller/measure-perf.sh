#!/usr/bin/env bash
set -euo pipefail

PORT=3001
URL="http://127.0.0.1:${PORT}"

echo "Starting controller on port $PORT..."
PORT=$PORT node dist/server.js > /tmp/controller-perf.log 2>&1 &
CPID=$!

cleanup() {
    echo "Stopping controller (PID: $CPID)..."
    kill "$CPID" 2>/dev/null || true
    wait "$CPID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for controller to become ready..."
for i in {1..20}; do
    if curl -s "$URL/health/ready" | grep -q '"ready":true'; then
        break
    fi
    sleep 1
done

echo "Controller is ready."

echo "=== 1. API Latency Measurements (10 requests each with 50ms spacing) ==="
for ep in "/health/live" "/health/ready" "/metrics" "/api/metrics" "/api/operations/status" "/api/quotas"; do
    avg_ms=$(python3 -c "
import urllib.request, time
times = []
for _ in range(10):
    t0 = time.perf_counter()
    urllib.request.urlopen('$URL$ep')
    times.append((time.perf_counter() - t0) * 1000)
    time.sleep(0.05)
print(f'{sum(times)/len(times):.2f} ms (min: {min(times):.2f} ms, max: {max(times):.2f} ms)')
")
    echo "Endpoint $ep : $avg_ms"
done

echo ""
echo "=== 2. Memory & Enforcement Cycles (waiting for 6 cycles, ~30s) ==="
initial_mem=$(curl -s "$URL/health/live" | jq -r '.memoryUsage | "RSS: \(.rssBytes / 1024 / 1024 | round)MB, Heap: \(.heapUsedBytes / 1024 / 1024 | round)MB"')
echo "Initial Memory: $initial_mem"

echo "Waiting 32 seconds to observe repeated enforcement cycles..."
sleep 32

final_mem=$(curl -s "$URL/health/live" | jq -r '.memoryUsage | "RSS: \(.rssBytes / 1024 / 1024 | round)MB, Heap: \(.heapUsedBytes / 1024 / 1024 | round)MB"')
echo "Final Memory (after 6 cycles): $final_mem"

echo ""
echo "=== 3. Observability & Operational Metrics Telemetry ==="
echo "--- Operations Status ---"
curl -s "$URL/api/operations/status" | jq '{
    status,
    uptimeSeconds,
    openwrtCircuitBreaker: .openwrt.circuitBreaker,
    lastRunDurationMs: .monitor.lastRunDurationMs,
    totalRuns: .monitor.totalRuns,
    lastEnforcementDurationMs: .lastEnforcement.durationMs,
    metricsSummary
}'

echo ""
echo "--- Metrics Telemetry ---"
curl -s "$URL/api/metrics" | jq '{
    http: .data.http,
    openwrt: .data.openwrt,
    quota: .data.quota,
    resilience: .data.resilience,
    system: .data.system
}'

echo "=== Performance verification complete ==="

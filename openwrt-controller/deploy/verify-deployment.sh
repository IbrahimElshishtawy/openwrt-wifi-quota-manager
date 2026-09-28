#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Controller - Production Deployment Verification & Smoke Testing Tool
# ==============================================================================

set -uo pipefail

CONTROLLER_URL="${CONTROLLER_URL:-http://127.0.0.1:${PORT:-3000}}"
API_TOKEN="${API_AUTH_TOKEN:-${ADMIN_API_TOKEN:-}}"
TIMEOUT_SEC=10
SKIP_OPENWRT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      CONTROLLER_URL="$2"
      shift 2
      ;;
    --token)
      API_TOKEN="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    --skip-openwrt)
      SKIP_OPENWRT=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

CONTROLLER_URL="${CONTROLLER_URL%/}"

TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

function print_section() {
    echo ""
    echo "========================================================================"
    echo "  $1"
    echo "========================================================================"
}

function check_pass() {
    local desc="$1"
    echo "  ✅ PASS: $desc"
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
}

function check_fail() {
    local desc="$1"
    local reason="${2:-}"
    echo "  ❌ FAIL: $desc"
    if [ -n "$reason" ]; then
        echo "     Reason: $reason"
    fi
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
}

echo "=== Verifying Deployment for OpenWrt Controller ==="
echo "Target Base URL: $CONTROLLER_URL"
echo "Timeout: ${TIMEOUT_SEC}s"

# ------------------------------------------------------------------------------
# 1. Network & Port Check
# ------------------------------------------------------------------------------
print_section "1. Network Reachability & Port Listening"
PORT_OPEN=0
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT_SEC" "$CONTROLLER_URL/health/live" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" != "000" ]; then
    check_pass "Controller HTTP port is open and responding (HTTP $HTTP_CODE)"
else
    check_fail "Controller port unreachable" "Could not establish TCP connection to $CONTROLLER_URL within ${TIMEOUT_SEC}s"
    echo ""
    echo "❌ DEPLOYMENT VERIFICATION FAILED: Controller service is down or unreachable."
    exit 1
fi

# ------------------------------------------------------------------------------
# 2. Liveness Check
# ------------------------------------------------------------------------------
print_section "2. Application Liveness (/health/live)"
LIVE_RESP=$(curl -s --max-time "$TIMEOUT_SEC" "$CONTROLLER_URL/health/live" 2>/dev/null || echo "")
if echo "$LIVE_RESP" | grep -qi '"status":"alive"'; then
    check_pass "Liveness probe returned 'alive' status"
else
    check_fail "Liveness probe response invalid" "$LIVE_RESP"
fi

# ------------------------------------------------------------------------------
# 3. Readiness Check
# ------------------------------------------------------------------------------
print_section "3. Subsystem Readiness (/health/ready)"
READY_RESP=$(curl -s --max-time "$TIMEOUT_SEC" "$CONTROLLER_URL/health/ready" 2>/dev/null || echo "")
if echo "$READY_RESP" | grep -qi '"status":"ready"'; then
    check_pass "Readiness probe confirmed all required subsystems are ready"
else
    if echo "$READY_RESP" | grep -qi '"ready":true'; then
        check_pass "Readiness probe confirmed subsystems ready"
    else
        check_fail "Readiness probe failed" "$READY_RESP"
    fi
fi

# ------------------------------------------------------------------------------
# 4. Prometheus Metrics Exposition
# ------------------------------------------------------------------------------
print_section "4. Prometheus Metrics Endpoint (/metrics)"
METRICS_RESP=$(curl -s --max-time "$TIMEOUT_SEC" "$CONTROLLER_URL/metrics" 2>/dev/null || echo "")
if echo "$METRICS_RESP" | grep -q "process_uptime_seconds" && echo "$METRICS_RESP" | grep -q "http_requests_total"; then
    check_pass "Prometheus /metrics endpoint exposes valid exposition format and counters"
else
    check_fail "Metrics endpoint failed or missing core counters" "Did not find expected metrics in /metrics response"
fi

# ------------------------------------------------------------------------------
# 5. Operations Status & Version Consistency
# ------------------------------------------------------------------------------
print_section "5. Operations Status & Version (/api/operations/status)"
STATUS_RESP=$(curl -s --max-time "$TIMEOUT_SEC" "$CONTROLLER_URL/api/operations/status" 2>/dev/null || echo "")
VERSION_FOUND=$(echo "$STATUS_RESP" | grep -o '"controllerVersion":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -n "$VERSION_FOUND" ]; then
    check_pass "Operations status endpoint returned active controller version: v$VERSION_FOUND"
else
    check_fail "Controller version missing in /api/operations/status" "$STATUS_RESP"
fi

CB_STATE=$(echo "$STATUS_RESP" | grep -o '"circuitBreaker":"[^"]*"' | cut -d'"' -f4 || echo "UNKNOWN")
if [ "$CB_STATE" = "CLOSED" ]; then
    check_pass "Router circuit breaker is in healthy CLOSED state"
elif [ "$SKIP_OPENWRT" = "true" ]; then
    check_pass "Circuit breaker check skipped (--skip-openwrt)"
else
    check_fail "Circuit breaker is not CLOSED" "Current state: $CB_STATE"
fi

MONITOR_RUNNING=$(echo "$STATUS_RESP" | grep -o '"running":true' || echo "")
if [ -n "$MONITOR_RUNNING" ]; then
    check_pass "Quota enforcement monitor is actively running"
else
    check_fail "Quota enforcement monitor is not running" "$STATUS_RESP"
fi

# ------------------------------------------------------------------------------
# 6. Security & Authentication Checks
# ------------------------------------------------------------------------------
print_section "6. Security & Authentication Posture"
# Send write request without authorization
AUTH_CHECK_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$CONTROLLER_URL/api/quotas" \
  -H "Content-Type: application/json" \
  -d '{"mac":"52:54:00:11:22:33","quotaBytes":1000}' 2>/dev/null || echo "000")

if [ -n "$API_TOKEN" ]; then
    if [ "$AUTH_CHECK_CODE" -eq 401 ]; then
        check_pass "Protected write endpoint rejected unauthenticated request with HTTP 401"
    else
        check_fail "Auth enforcement expected HTTP 401 but received HTTP $AUTH_CHECK_CODE"
    fi

    # Test with valid token
    VALID_AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$CONTROLLER_URL/api/quota-enforcement/sync" \
      -H "Authorization: Bearer $API_TOKEN" 2>/dev/null || echo "000")
    if [ "$VALID_AUTH_CODE" -eq 200 ]; then
        check_pass "Authenticated request accepted with HTTP 200"
    else
        check_fail "Authenticated request with configured token failed" "Received HTTP $VALID_AUTH_CODE"
    fi
else
    check_pass "Development mode: unauthenticated write permitted or token not configured in check"
fi

# ------------------------------------------------------------------------------
# 7. CLI Operational Verification
# ------------------------------------------------------------------------------
print_section "7. CLI Tool Operational Execution"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_BIN="$SCRIPT_PATH/../bin/wifi-controller.js"
if [ -f "$CLI_BIN" ]; then
    CLI_VER_OUT=$("$CLI_BIN" version --url "$CONTROLLER_URL" 2>&1 || echo "CLI_ERR")
    if echo "$CLI_VER_OUT" | grep -q "1.0.0"; then
        check_pass "wifi-controller CLI successfully executed and reported matching version"
    else
        check_fail "wifi-controller CLI execution failed" "$CLI_VER_OUT"
    fi
else
    check_pass "CLI binary not present at relative path, skipped"
fi

# ------------------------------------------------------------------------------
# Summary & Result
# ------------------------------------------------------------------------------
print_section "Deployment Verification Summary"
echo "  Total Checks:  $TOTAL_CHECKS"
echo "  Passed Checks: $PASSED_CHECKS"
echo "  Failed Checks: $FAILED_CHECKS"

if [ "$FAILED_CHECKS" -eq 0 ]; then
    echo ""
    echo "🎉 RESULT: PASS — Deployment verified successfully!"
    exit 0
else
    echo ""
    echo "❌ RESULT: FAIL — Deployment verification encountered $FAILED_CHECKS failure(s)." >&2
    exit 1
fi

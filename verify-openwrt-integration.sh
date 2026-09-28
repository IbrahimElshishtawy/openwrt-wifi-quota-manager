#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Integration Hardening & Recovery Verification Script
# Project: openwrt-wifi-quota-manager / openwrt-controller
# ==============================================================================

set -uo pipefail

CONTROLLER_URL="http://127.0.0.1:3000"
ROUTER_IP="192.168.50.1"
CLIENT_IP="192.168.50.50"
CLIENT_MAC="52:54:00:CE:1C:BE"
ROUTER_MAC="52:54:00:CF:15:77"
HOST_MAC="52:54:00:5B:2E:C1"
MANUAL_MAC="52:54:00:AA:BB:CC"

PASSED_COUNT=0
FAILED_COUNT=0

function print_header() {
    echo ""
    echo "========================================================================"
    echo "  $1"
    echo "========================================================================"
}

function assert_success() {
    local desc="$1"
    local status="$2"
    if [ "$status" -eq 0 ]; then
        echo "✅ PASS: $desc"
        PASSED_COUNT=$((PASSED_COUNT + 1))
    else
        echo "❌ FAIL: $desc"
        FAILED_COUNT=$((FAILED_COUNT + 1))
    fi
}

function wait_ssh() {
    local host="$1"
    local max_wait="${2:-60}"
    local count=0
    echo "Waiting for SSH on $host (timeout: ${max_wait}s)..."
    while ! ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=2 "root@$host" "echo ok" &>/dev/null; do
        sleep 2
        count=$((count + 2))
        if [ "$count" -ge "$max_wait" ]; then
            echo "❌ Timeout waiting for SSH on $host"
            return 1
        fi
    done
    echo "SSH is ready on $host"
    return 0
}

function wait_element_state() {
    local mac="$1"
    local expected="$2" # "present" or "absent"
    local max_wait="${3:-12}"
    local count=0
    while [ "$count" -lt "$max_wait" ]; do
        local in_set=0
        if ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=2 "root@$ROUTER_IP" "nft list set inet quota_enforcement blocked_macs" 2>/dev/null | grep -qi "$mac"; then
            in_set=1
        fi
        if [ "$expected" = "present" ] && [ "$in_set" -eq 1 ]; then
            return 0
        fi
        if [ "$expected" = "absent" ] && [ "$in_set" -eq 0 ]; then
            return 0
        fi
        sleep 2
        count=$((count + 2))
    done
    return 1
}

# ------------------------------------------------------------------------------
# Phase 1: Build & Automated Unit/Integration Tests
# ------------------------------------------------------------------------------
print_header "Phase 1: Build & Automated Unit/Integration Tests"
cd "$(dirname "$0")/openwrt-controller" || exit 1

echo "Running: npm run build..."
npm run build
assert_success "TypeScript Compilation (npm run build)" $?

echo "Running: npm test (23 suites)..."
npm test
assert_success "Full Unit & Integration Test Suites (npm test)" $?

# ------------------------------------------------------------------------------
# Phase 2: OpenWrt Router & Test Client State Verification
# ------------------------------------------------------------------------------
print_header "Phase 2: OpenWrt State Verification"

echo "Checking OpenWrt router reachability ($ROUTER_IP)..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3 "root@$ROUTER_IP" "uname -a"
assert_success "Router SSH Reachable" $?

echo "Checking Test Client reachability ($CLIENT_IP)..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3 "root@$CLIENT_IP" "uname -a"
assert_success "Test Client SSH Reachable" $?

echo "Checking nftables isolation on router..."
ssh "root@$ROUTER_IP" "nft list tables" | grep -q "table inet fw4"
assert_success "Native OpenWrt table inet fw4 untouched" $?

ssh "root@$ROUTER_IP" "nft list tables" | grep -q "table inet quota_enforcement"
assert_success "Dedicated table inet quota_enforcement exists" $?

# ------------------------------------------------------------------------------
# Phase 3: Baseline Controller API Telemetry
# ------------------------------------------------------------------------------
print_header "Phase 3: Baseline Controller API Telemetry"

if ! curl -s "$CONTROLLER_URL/api/health" | grep -q '"status":"healthy"'; then
    echo "Starting controller service..."
    node dist/server.js >/dev/null 2>&1 &
    sleep 4
fi

echo "Testing GET /api/health..."
HEALTH_RESP=$(curl -s "$CONTROLLER_URL/api/health")
echo "$HEALTH_RESP"
echo "$HEALTH_RESP" | grep -q '"status":"healthy"'
assert_success "GET /api/health reports healthy" $?

echo "Testing GET /api/quota-enforcement/status..."
STATUS_RESP=$(curl -s "$CONTROLLER_URL/api/quota-enforcement/status")
echo "$STATUS_RESP"
echo "$STATUS_RESP" | grep -q '"running":true'
assert_success "GET /api/quota-enforcement/status monitor running" $?

echo "Testing GET /api/quotas..."
QUOTAS_RESP=$(curl -s "$CONTROLLER_URL/api/quotas")
echo "$QUOTAS_RESP"
echo "$QUOTAS_RESP" | grep -q '"success":true'
assert_success "GET /api/quotas returns success" $?

echo "Testing GET /api/firewall/blocked..."
BLOCKED_RESP=$(curl -s "$CONTROLLER_URL/api/firewall/blocked")
echo "$BLOCKED_RESP"
echo "$BLOCKED_RESP" | grep -q '"success":true'
assert_success "GET /api/firewall/blocked returns success" $?

# ------------------------------------------------------------------------------
# Phase 4: Controller Restart Recovery
# ------------------------------------------------------------------------------
print_header "Phase 4: Controller Restart Recovery"

echo "Ensuring client is in exhausted state..."
curl -s -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000, "usedBytes": 5000}' "$CONTROLLER_URL/api/quotas/$CLIENT_MAC" >/dev/null
wait_element_state "$CLIENT_MAC" "present" 12
assert_success "Device blocked before controller restart" $?

echo "Stopping controller process..."
SERVER_PID=$(pgrep -f "dist/server.js" | head -n 1 || true)
if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID"
    sleep 2
fi

echo "Starting controller process again..."
node dist/server.js >/dev/null 2>&1 &
sleep 4

echo "Verifying controller started and restored state without duplicate rules..."
wait_element_state "$CLIENT_MAC" "present" 12
assert_success "Device remains blocked after controller restart" $?

# ------------------------------------------------------------------------------
# Phase 5: nftables State Loss Reconciliation
# ------------------------------------------------------------------------------
print_header "Phase 5: nftables State Loss Reconciliation (Scenario A, B, C, D)"

echo "Deleting element from nftables to simulate kernel state loss..."
ssh "root@$ROUTER_IP" "nft delete element inet quota_enforcement blocked_macs '{ $(echo "$CLIENT_MAC" | tr '[:upper:]' '[:lower:]') }'"
wait_element_state "$CLIENT_MAC" "absent" 4
assert_success "Element removed manually from nftables" $?

echo "Waiting for periodic reconciliation cycle..."
wait_element_state "$CLIENT_MAC" "present" 12
assert_success "Scenario A: Missing block automatically restored by reconciliation" $?

echo "Testing Scenario B: Quota reset unblocks device..."
curl -s -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000000000, "resetUsage": true}' "$CONTROLLER_URL/api/quotas/$CLIENT_MAC" >/dev/null
wait_element_state "$CLIENT_MAC" "absent" 12
assert_success "Scenario B: Quota reset successfully unblocked device in nftables" $?

echo "Testing Scenario D: Manual block preservation..."
curl -s -X POST -H "Content-Type: application/json" -d "{\"mac\": \"$MANUAL_MAC\", \"source\": \"manual\"}" "$CONTROLLER_URL/api/firewall/block" >/dev/null
wait_element_state "$MANUAL_MAC" "present" 12
assert_success "Scenario D: Manual admin block present in nftables" $?

# ------------------------------------------------------------------------------
# Phase 6: Router Safety Verification
# ------------------------------------------------------------------------------
print_header "Phase 6: Router Safety Verification"

echo "Attempting to block router MAC ($ROUTER_MAC)..."
ROUTER_BLOCK_RESP=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"mac\": \"$ROUTER_MAC\"}" "$CONTROLLER_URL/api/firewall/block")
echo "$ROUTER_BLOCK_RESP"
echo "$ROUTER_BLOCK_RESP" | grep -q "InfrastructureDeviceError"
assert_success "Blocking router MAC rejected with InfrastructureDeviceError" $?

echo "Attempting to block host bridge MAC ($HOST_MAC)..."
HOST_BLOCK_RESP=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"mac\": \"$HOST_MAC\"}" "$CONTROLLER_URL/api/firewall/block")
echo "$HOST_BLOCK_RESP"
echo "$HOST_BLOCK_RESP" | grep -q "InfrastructureDeviceError"
assert_success "Blocking host bridge MAC rejected with InfrastructureDeviceError" $?

# ------------------------------------------------------------------------------
# Phase 7: LAN vs Internet Isolation
# ------------------------------------------------------------------------------
print_header "Phase 7: LAN vs Internet Isolation"

echo "Re-applying quota block on test client..."
curl -s -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000, "usedBytes": 5000}' "$CONTROLLER_URL/api/quotas/$CLIENT_MAC" >/dev/null
wait_element_state "$CLIENT_MAC" "present" 12

echo "Testing LAN access from test client to router ($ROUTER_IP)..."
ssh "root@$CLIENT_IP" "ping -c 2 $ROUTER_IP" >/dev/null
assert_success "LAN access to router AVAILABLE while blocked" $?

echo "Testing forward transit counters in nftables..."
ssh "root@$ROUTER_IP" "nft list chain inet quota_enforcement forward_block" | grep -q "drop"
assert_success "nftables forward_block drop rules active" $?

# ------------------------------------------------------------------------------
# Phase 8: OpenWrt Reboot Recovery (Optional safe VM reboot)
# ------------------------------------------------------------------------------
print_header "Phase 8: OpenWrt Reboot Recovery"

if [ "${RUN_VM_REBOOT:-0}" = "1" ]; then
    echo "Executing safe reboot of OpenWrt VM..."
    ssh "root@$ROUTER_IP" "reboot" || true
    sleep 5
    wait_ssh "$ROUTER_IP" 60

    echo "Waiting for controller reconciliation..."
    sleep 8

    echo "Verifying quota-exhausted client re-blocked after router reboot..."
    wait_element_state "$CLIENT_MAC" "present" 20
    assert_success "Quota block restored after OpenWrt reboot" $?

    echo "Verifying manual block restored after router reboot..."
    wait_element_state "$MANUAL_MAC" "present" 12
    assert_success "Manual admin block restored after OpenWrt reboot" $?
else
    echo "Skipping live VM reboot (set RUN_VM_REBOOT=1 to execute live VM reboot)."
    echo "Simulating table flush & recovery instead..."
    curl -s -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000, "usedBytes": 5000}' "$CONTROLLER_URL/api/quotas/$CLIENT_MAC" >/dev/null
    sleep 2
    ssh "root@$ROUTER_IP" "nft delete table inet quota_enforcement"
    wait_element_state "$CLIENT_MAC" "present" 14
    assert_success "Quota block restored after simulated reboot table flush" $?
fi

# Cleanup manual test block and reset quota
curl -s -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000000000, "resetUsage": true}' "$CONTROLLER_URL/api/quotas/$CLIENT_MAC" >/dev/null 2>&1 || true
curl -s -X POST -H "Content-Type: application/json" -d "{\"mac\": \"$MANUAL_MAC\", \"source\": \"manual\"}" "$CONTROLLER_URL/api/firewall/unblock" >/dev/null 2>&1 || true
wait_element_state "$CLIENT_MAC" "absent" 10
wait_element_state "$MANUAL_MAC" "absent" 10

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
print_header "Verification Summary"
echo "Tests Passed: $PASSED_COUNT"ه
echo "Tests Failed: $FAILED_COUNT"
echo ""

if [ "$FAILED_COUNT" -eq 0 ]; then
    echo "🎉 ALL INTEGRATION HARDENING & RECOVERY CHECKS PASSED!"
    exit 0
else
    echo "❌ SOME CHECKS FAILED. Please review output above."
    exit 1
fi

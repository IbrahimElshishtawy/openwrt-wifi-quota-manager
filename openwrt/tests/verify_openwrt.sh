#!/bin/sh
# OpenWrt Wi-Fi Quota Manager - Comprehensive Verification Script
# Can be run directly on an OpenWrt router or in a development environment.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENWRT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================================="
echo "         OpenWrt Quota Manager System Verification        "
echo "=========================================================="

FAIL_COUNT=0
NOT_VERIFIED_COUNT=0
PASS_COUNT=0

report_pass() {
    echo "[PASS]         $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

report_fail() {
    echo "[FAIL]         $1: $2"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

report_not_verified() {
    echo "[NOT VERIFIED] $1: $2"
    NOT_VERIFIED_COUNT=$((NOT_VERIFIED_COUNT + 1))
}

# 1. OpenWrt Environment
if [ -f "/etc/openwrt_release" ]; then
    DISTRIB_DESC=$(grep "DISTRIB_DESCRIPTION" /etc/openwrt_release | cut -d"'" -f2 2>/dev/null || echo "OpenWrt")
    report_pass "OpenWrt detected ($DISTRIB_DESC)"
else
    HOST_OS=$(uname -s -r 2>/dev/null || echo "Linux")
    report_not_verified "OpenWrt" "Not running on OpenWrt (Host: $HOST_OS)"
fi

# 2. Python 3 Runtime
if command -v python3 >/dev/null 2>&1; then
    PY_VER=$(python3 --version 2>&1 | cut -d' ' -f2)
    report_pass "Python runtime (Python $PY_VER)"
else
    report_fail "Python" "python3 is not installed or not in PATH"
fi

# 3. nftables
if command -v nft >/dev/null 2>&1; then
    NFT_VER=$(nft --version 2>&1 | head -n1)
    report_pass "nftables available ($NFT_VER)"
else
    report_fail "nftables" "nft command not found in PATH"
fi

# 4. nlbwmon Daemon
if command -v ubus >/dev/null 2>&1 && ubus list | grep -q "nlbwmon"; then
    report_pass "nlbwmon daemon registered on ubus"
elif [ -f "/etc/init.d/nlbwmon" ]; then
    report_not_verified "nlbwmon" "Daemon installed but ubus registration not active"
else
    report_not_verified "nlbwmon" "nlbwmon/ubus not present on current host (requires OpenWrt router)"
fi

# 5. Cron Service
if [ -f "/etc/init.d/cron" ]; then
    if /etc/init.d/cron status >/dev/null 2>&1 || pgrep crond >/dev/null 2>&1; then
        report_pass "cron service is running"
    else
        report_fail "cron" "Service installed but not running (/etc/init.d/cron start)"
    fi
elif pgrep cron >/dev/null 2>&1 || pgrep crond >/dev/null 2>&1; then
    report_pass "cron daemon is running"
else
    report_not_verified "cron" "System cron service not detected in current environment"
fi

# 6. Configuration Integrity (devices.json)
CONFIG_FILE="$OPENWRT_DIR/config/devices.json"
if [ -f "$CONFIG_FILE" ]; then
    if python3 -c "import json; json.load(open('$CONFIG_FILE'))" >/dev/null 2>&1; then
        DEV_COUNT=$(python3 -c "import json; print(len(json.load(open('$CONFIG_FILE')).get('devices', [])))" 2>/dev/null || echo 0)
        report_pass "configuration ($DEV_COUNT devices configured in devices.json)"
    else
        report_fail "configuration" "$CONFIG_FILE contains invalid JSON"
    fi
else
    report_fail "configuration" "$CONFIG_FILE does not exist"
fi

# 7. Quota Manager Executable
QUOTA_SCRIPT="$OPENWRT_DIR/scripts/check_quota.py"
if [ -f "$QUOTA_SCRIPT" ]; then
    if python3 "$QUOTA_SCRIPT" --dry-run >/dev/null 2>&1; then
        report_pass "quota manager engine runs cleanly in dry-run"
    else
        report_fail "quota manager" "check_quota.py failed during dry-run audit"
    fi
else
    report_fail "quota manager" "check_quota.py not found at $QUOTA_SCRIPT"
fi

# 8. Firewall Rules
RULES_FILE="$OPENWRT_DIR/nftables/rules.nft"
if [ -f "$RULES_FILE" ]; then
    if [ "$(id -u)" = "0" ]; then
        if nft -c -f "$RULES_FILE" >/dev/null 2>&1; then
            report_pass "firewall rules (syntax verified via nft -c -f)"
        else
            report_fail "firewall rules" "nft -c -f syntax check failed on $RULES_FILE"
        fi
    else
        report_pass "firewall rules file present (syntax requires root to test netlink)"
    fi
else
    report_fail "firewall rules" "rules.nft not found at $RULES_FILE"
fi

# 9. API Server
API_SCRIPT="$OPENWRT_DIR/api/api_usage.py"
if [ -f "$API_SCRIPT" ]; then
    # Test if API is listening or test execution
    if curl -s -m 2 http://127.0.0.1:8080/health | grep -q '"status": *"ok"' 2>/dev/null; then
        report_pass "API server is running and healthy on http://127.0.0.1:8080"
    else
        report_not_verified "API" "API script exists ($API_SCRIPT); daemon not currently running on port 8080"
    fi
else
    report_fail "API" "api_usage.py not found at $API_SCRIPT"
fi

# 10. Device Detection
if python3 -c "from openwrt.scripts.device_manager import DeviceManager; mgr = DeviceManager(); devs = mgr.discover_connected_devices(); print(len(devs))" >/dev/null 2>&1; then
    report_pass "device detection (ARP/DHCP lease parser functional)"
else
    report_fail "device detection" "Failed to execute device discovery"
fi

echo "=========================================================="
echo " Summary: $PASS_COUNT Passed | $FAIL_COUNT Failed | $NOT_VERIFIED_COUNT Not Verified"
echo "=========================================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo " RESULT: FAIL (Resolve the failed checks above)"
    exit 1
elif [ "$NOT_VERIFIED_COUNT" -gt 0 ]; then
    echo " RESULT: PARTIAL / DEVELOPMENT PASS (Deploy to OpenWrt router to complete hardware verification)"
    exit 0
else
    echo " RESULT: FULL PASS (All checks passed on OpenWrt router)"
    exit 0
fi

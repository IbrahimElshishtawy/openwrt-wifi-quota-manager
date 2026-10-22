#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Wi-Fi Quota Manager - Environment & Health Check (dev-check.sh)
# ==============================================================================

set -uo pipefail

CONTROLLER_URL="http://127.0.0.1:3050"
ROUTER_IP="192.168.50.1"

echo ""
echo "========================================================================"
echo "📊 System Status & Connectivity Verification"
echo "========================================================================"

# 1. Controller Health
echo -n "• Controller API ($CONTROLLER_URL): "
if curl -s "$CONTROLLER_URL/health/live" | grep -q '"status":"alive"'; then
    echo "🟢 ONLINE"
else
    echo "🔴 OFFLINE"
fi

# 2. OpenWrt Router Reachability
echo -n "• OpenWrt Router ($ROUTER_IP): "
if ping -c 1 -W 1 "$ROUTER_IP" &>/dev/null; then
    echo "🟢 REACHABLE"
else
    echo "🔴 UNREACHABLE"
fi

# 3. Router SSH & nftables status
echo -n "• Router SSH & nftables: "
if ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=2 "root@$ROUTER_IP" "nft list table inet quota_enforcement" &>/dev/null; then
    echo "🟢 CONFIGURED"
else
    echo "🟡 SSH/NFT NOT VERIFIED"
fi

# 4. Connected Devices count via Controller
DEVICES_COUNT=$(curl -s "$CONTROLLER_URL/api/devices" | grep -o '"count":[0-9]*' | cut -d: -f2 || echo "0")
echo "• Connected LAN Devices: ${DEVICES_COUNT:-0}"

# 5. Quota Records
QUOTAS_COUNT=$(curl -s "$CONTROLLER_URL/api/quotas" | grep -o '"count":[0-9]*' | cut -d: -f2 || echo "0")
echo "• Active Quotas: ${QUOTAS_COUNT:-0}"

# 6. Blocked Devices
BLOCKED_COUNT=$(curl -s "$CONTROLLER_URL/api/firewall/blocked" | grep -o '"count":[0-9]*' | cut -d: -f2 || echo "0")
echo "• Currently Blocked Devices: ${BLOCKED_COUNT:-0}"

echo "========================================================================"
echo "📱 Flutter Application Instructions"
echo "========================================================================"
echo "1. Android APK Built & Ready at:"
echo "   flutter_client/build/app/outputs/flutter-apk/app-debug.apk"
echo ""
echo "2. Running Flutter on Linux Desktop / Emulator / Device:"
echo "   cd flutter_client"
echo "   flutter run -d <device-id>"
echo ""
echo "3. Controller Base URLs by platform:"
echo "   • Linux Desktop:  http://127.0.0.1:3050"
echo "   • Android Emulator: http://10.0.2.2:3050"
echo "   • Physical Phone: http://<HOST_LAN_IP>:3050 (e.g. 192.168.1.10:3050)"
echo ""
echo "4. Stopping Services (without data loss):"
echo "   cd openwrt-controller/deploy/docker && docker compose down"
echo "========================================================================"

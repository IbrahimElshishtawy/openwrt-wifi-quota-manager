#!/bin/sh
# OpenWrt Wi-Fi Quota Manager - Router Uninstallation Script
# Removes services, cron jobs, and firewall rules cleanly

set -e

echo "========================================================"
echo "    Uninstalling OpenWrt Wi-Fi Quota Manager Subsystem  "
echo "========================================================"

# 1. Stop and remove procd service
if [ -f /etc/init.d/quota-manager ]; then
    echo "[INFO] Stopping and disabling quota-manager service..."
    /etc/init.d/quota-manager stop 2>/dev/null || true
    /etc/init.d/quota-manager disable 2>/dev/null || true
    rm -f /etc/init.d/quota-manager
fi

# 2. Remove nftables rules and persistent file
echo "[INFO] Cleaning up nftables rules..."
nft delete table inet quota_manager 2>/dev/null || true
rm -f /etc/nftables.d/99-quota-manager.nft

# 3. Remove cron entry
if [ -f /etc/crontabs/root ]; then
    echo "[INFO] Removing crontab entry..."
    sed -i '/check_quota.py/d' /etc/crontabs/root
    /etc/init.d/cron restart 2>/dev/null || true
fi

# 4. Clean up volatile warning state and logs
rm -f /tmp/quota_warning_state.json
rm -f /tmp/quota_warning_state.tmp

echo "========================================================"
echo "      Uninstallation Completed Successfully!            "
echo "========================================================"

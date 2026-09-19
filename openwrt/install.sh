#!/bin/sh
# OpenWrt Wi-Fi Quota Manager - Router Installation Script
# Run this script directly on your OpenWrt router via SSH

set -e

echo "========================================================"
echo "    Installing OpenWrt Wi-Fi Quota Manager Subsystem    "
echo "========================================================"

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[INFO] Installation source directory: $INSTALL_DIR"

# 1. Check or install dependencies
echo "[INFO] Checking system dependencies..."
MISSING_PKGS=""
for pkg in python3-base nlbwmon nftables; do
    if ! opkg list-installed 2>/dev/null | grep -q "^$pkg "; then
        MISSING_PKGS="$MISSING_PKGS $pkg"
    fi
done

if [ -n "$MISSING_PKGS" ]; then
    echo "[INFO] Missing packages detected:$MISSING_PKGS"
    echo "[INFO] Running opkg update..."
    opkg update
    echo "[INFO] Installing packages:$MISSING_PKGS..."
    opkg install $MISSING_PKGS
else
    echo "[INFO] All required packages are already installed."
fi

# 2. Make scripts, services, and tests executable
echo "[INFO] Setting permissions on scripts..."
chmod +x "$INSTALL_DIR"/scripts/*.py 2>/dev/null || true
chmod +x "$INSTALL_DIR"/api/*.py 2>/dev/null || true
chmod +x "$INSTALL_DIR"/services/*.init 2>/dev/null || true
chmod +x "$INSTALL_DIR"/tests/*.sh 2>/dev/null || true
chmod +x "$INSTALL_DIR"/nftables/*.nft 2>/dev/null || true

# 3. Configure and start nlbwmon
echo "[INFO] Configuring and starting nlbwmon service..."
/etc/init.d/nlbwmon enable 2>/dev/null || true
/etc/init.d/nlbwmon restart 2>/dev/null || true

# 4. Install nftables access control rules
echo "[INFO] Installing nftables table and set..."
mkdir -p /etc/nftables.d
cp "$INSTALL_DIR/nftables/rules.nft" /etc/nftables.d/99-quota-manager.nft
nft -f /etc/nftables.d/99-quota-manager.nft 2>/dev/null || true

# 5. Install procd service
echo "[INFO] Installing procd system service..."
sed -e "s|APP_DIR=.*|APP_DIR=\"$INSTALL_DIR\"|g" \
    "$INSTALL_DIR/services/quota-manager.init" > /etc/init.d/quota-manager
chmod +x /etc/init.d/quota-manager
/etc/init.d/quota-manager enable
/etc/init.d/quota-manager restart 2>/dev/null || /etc/init.d/quota-manager start 2>/dev/null || true

# 6. Configure periodic cron job (every 1 minute)
echo "[INFO] Configuring cron schedule..."
mkdir -p /etc/crontabs
touch /etc/crontabs/root

CRON_CMD="* * * * * /usr/bin/python3 $INSTALL_DIR/scripts/check_quota.py >> /var/log/quota_manager.log 2>&1"
if ! grep -Fq "$INSTALL_DIR/scripts/check_quota.py" /etc/crontabs/root 2>/dev/null; then
    echo "$CRON_CMD" >> /etc/crontabs/root
    echo "[INFO] Crontab entry added."
else
    echo "[INFO] Crontab entry already exists."
fi

# Enable and start cron daemon
/etc/init.d/cron enable 2>/dev/null || true
/etc/init.d/cron restart 2>/dev/null || true

# 7. Run Verification Script
echo ""
echo "[INFO] Running automated system verification..."
if [ -f "$INSTALL_DIR/tests/verify_openwrt.sh" ]; then
    sh "$INSTALL_DIR/tests/verify_openwrt.sh" || true
fi

echo ""
echo "========================================================"
echo "      Installation Completed Successfully!              "
echo "========================================================"
echo "API Server:         http://<ROUTER_IP>:8080/health"
echo "Status check:       python3 $INSTALL_DIR/scripts/check_quota.py --status"
echo "Monitor logs:       tail -f /var/log/quota_manager.log"
echo "Service commands:   /etc/init.d/quota-manager {start|stop|restart|status}"
echo "========================================================"

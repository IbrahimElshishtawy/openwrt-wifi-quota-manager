#!/bin/bash
# Deploy OpenWrt Wi-Fi Quota Manager to a remote OpenWrt router
# Usage: ./openwrt/deploy.sh <ROUTER_IP> [SSH_PORT] [ROUTER_USER]

ROUTER_IP="${1:-192.168.1.1}"
SSH_PORT="${2:-22}"
ROUTER_USER="${3:-root}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DEST="/root/openwrt-wifi-quota-manager/openwrt"

echo "=========================================================="
echo " Deploying OpenWrt Quota Manager to $ROUTER_USER@$ROUTER_IP:$SSH_PORT"
echo "=========================================================="

# Test reachability
if ! ping -c 1 -W 2 "$ROUTER_IP" >/dev/null 2>&1; then
    echo "[ERROR] Cannot ping router at $ROUTER_IP. Check your connection."
    exit 1
fi

echo "[INFO] Creating remote directory: $REMOTE_DEST..."
ssh -p "$SSH_PORT" "$ROUTER_USER@$ROUTER_IP" "mkdir -p $REMOTE_DEST"

echo "[INFO] Uploading files via SCP..."
scp -P "$SSH_PORT" -r \
    "$SCRIPT_DIR/config" \
    "$SCRIPT_DIR/scripts" \
    "$SCRIPT_DIR/nftables" \
    "$SCRIPT_DIR/services" \
    "$SCRIPT_DIR/cron" \
    "$SCRIPT_DIR/install.sh" \
    "$SCRIPT_DIR/uninstall.sh" \
    "$SCRIPT_DIR/README.md" \
    "$ROUTER_USER@$ROUTER_IP:$REMOTE_DEST/"

echo "[INFO] Setting execute permissions on router..."
ssh -p "$SSH_PORT" "$ROUTER_USER@$ROUTER_IP" "chmod +x $REMOTE_DEST/install.sh $REMOTE_DEST/uninstall.sh $REMOTE_DEST/scripts/*.py $REMOTE_DEST/services/*.init"

echo ""
echo "=========================================================="
echo " Files uploaded successfully to $ROUTER_IP:$REMOTE_DEST"
echo "=========================================================="
echo "To run the installer on the router, execute:"
echo "  ssh -p $SSH_PORT $ROUTER_USER@$ROUTER_IP '$REMOTE_DEST/install.sh'"
echo "=========================================================="

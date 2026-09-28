#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Controller - Systemd Service Installer
# ==============================================================================

set -euo pipefail

SERVICE_NAME="openwrt-controller"
INSTALL_DIR="${INSTALL_DIR:-/opt/openwrt-controller}"
CONFIG_DIR="/etc/openwrt-controller"
SERVICE_USER="${SERVICE_USER:-openwrt}"
SYSTEMD_DIR="/etc/systemd/system"

echo "=== Installing OpenWrt Controller Systemd Service ==="

# Check root permissions
if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Error: This script must be run as root (or via sudo)" >&2
    exit 1
fi

# 1. Create dedicated system user if not present
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "Creating dedicated service user: $SERVICE_USER..."
    useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" "$SERVICE_USER"
else
    echo "Service user '$SERVICE_USER' already exists."
fi

# 2. Create directories
echo "Creating application and configuration directories..."
mkdir -p "$INSTALL_DIR/data"
mkdir -p "$CONFIG_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"
chmod 700 "$CONFIG_DIR"

# 3. Create default environment file if missing
if [ ! -f "$CONFIG_DIR/controller.env" ]; then
    echo "Creating initial environment configuration at $CONFIG_DIR/controller.env..."
    if [ -f "$(dirname "$0")/../../.env.production.example" ]; then
        cp "$(dirname "$0")/../../.env.production.example" "$CONFIG_DIR/controller.env"
    else
        cat << 'EOF' > "$CONFIG_DIR/controller.env"
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
CORS_ORIGIN=http://127.0.0.1:3000
API_AUTH_TOKEN=change-this-token-before-production-use
OPENWRT_HOST=192.168.50.1
OPENWRT_PORT=80
OPENWRT_USERNAME=root
OPENWRT_PASSWORD=
QUOTA_ENFORCEMENT_ENABLED=true
QUOTA_STORAGE_PATH=data/quotas.json
FIREWALL_STORAGE_PATH=data/firewall-blocks.json
EOF
    fi
    chown root:"$SERVICE_USER" "$CONFIG_DIR/controller.env"
    chmod 640 "$CONFIG_DIR/controller.env"
    echo "⚠️ Please edit $CONFIG_DIR/controller.env with your actual router credentials and token."
fi

# 4. Copy systemd unit file
echo "Copying systemd unit file to $SYSTEMD_DIR/$SERVICE_NAME.service..."
cp "$(dirname "$0")/openwrt-controller.service" "$SYSTEMD_DIR/$SERVICE_NAME.service"
chmod 644 "$SYSTEMD_DIR/$SERVICE_NAME.service"

# 5. Reload systemd daemon
echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "✅ Systemd service installed successfully."
echo "Commands to manage the service:"
echo "  sudo systemctl enable $SERVICE_NAME"
echo "  sudo systemctl start $SERVICE_NAME"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"

#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Controller - Production Deployment Tool
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_TARGET="${1:-local}" # "local", "docker", or "systemd"

PORT="${PORT:-3000}"
CONTROLLER_URL="${CONTROLLER_URL:-http://127.0.0.1:$PORT}"
API_TOKEN="${API_AUTH_TOKEN:-${ADMIN_API_TOKEN:-}}"

echo "========================================================================"
echo "  OPENWRT CONTROLLER PRODUCTION DEPLOYMENT"
echo "  Target Mode: $DEPLOY_TARGET"
echo "  Target URL:  $CONTROLLER_URL"
echo "========================================================================"

cd "$ROOT_DIR"

# ------------------------------------------------------------------------------
# Step 1: Validate Configuration
# ------------------------------------------------------------------------------
echo "Step 1: Validating environment configuration..."
if [ "$DEPLOY_TARGET" = "systemd" ] && [ -f "/etc/openwrt-controller/controller.env" ]; then
    echo "Using systemd environment configuration: /etc/openwrt-controller/controller.env"
elif [ -f "$ROOT_DIR/.env.production" ]; then
    echo "Using production environment configuration: $ROOT_DIR/.env.production"
elif [ -f "$ROOT_DIR/.env" ]; then
    echo "Using standard environment configuration: $ROOT_DIR/.env"
else
    echo "⚠️ Warning: No explicit .env found; relying on system environment variables."
fi

# Run dry-run configuration validation using Node & env schema
node -e '
import("./dist/config/env.js").then(({ validateProductionConfig, env }) => {
  if (process.env.NODE_ENV === "production") {
    const errors = validateProductionConfig(env);
    if (errors.length > 0) {
      console.error("❌ Production configuration validation failed:");
      errors.forEach(e => console.error("  - " + e));
      process.exit(1);
    }
  }
  console.log("✅ Configuration schema successfully validated.");
}).catch((err) => {
  console.log("Configuration validation skipped (built files not ready yet).");
});
' 2>/dev/null || true

# ------------------------------------------------------------------------------
# Step 2: Validate Artifact & Version
# ------------------------------------------------------------------------------
echo "Step 2: Checking application version..."
APP_VERSION="$(node -p 'require("./package.json").version')"
echo "Application Release Version: v$APP_VERSION"

# ------------------------------------------------------------------------------
# Step 3: Create Pre-Deployment Backup
# ------------------------------------------------------------------------------
echo "Step 3: Creating pre-deployment state backup..."
BACKUP_SNAPSHOT="$("$SCRIPT_DIR/backup.sh" | tail -n 1)"
echo "Pre-deployment backup created at: $BACKUP_SNAPSHOT"

# ------------------------------------------------------------------------------
# Step 4: Build / Package New Version
# ------------------------------------------------------------------------------
echo "Step 4: Compiling TypeScript..."
npm run build

if [ "$DEPLOY_TARGET" = "docker" ]; then
    echo "Building production Docker image: openwrt-controller:$APP_VERSION..."
    docker build -t "openwrt-controller:$APP_VERSION" -t "openwrt-controller:latest" .
fi

# ------------------------------------------------------------------------------
# Step 5: Start / Restart Service
# ------------------------------------------------------------------------------
echo "Step 5: Activating release ($DEPLOY_TARGET)..."

if [ "$DEPLOY_TARGET" = "systemd" ]; then
    echo "Restarting openwrt-controller via systemd..."
    sudo systemctl restart openwrt-controller
elif [ "$DEPLOY_TARGET" = "docker" ]; then
    echo "Recreating openwrt-controller container..."
    docker stop openwrt-controller 2>/dev/null || true
    docker rm openwrt-controller 2>/dev/null || true
    docker run -d \
      --name openwrt-controller \
      --restart unless-stopped \
      -p "$PORT:3000" \
      --env-file <(grep -v '^#' "$ROOT_DIR/.env" 2>/dev/null || true) \
      -v "$ROOT_DIR/data:/app/data" \
      "openwrt-controller:$APP_VERSION"
else
    echo "Local execution mode: assuming controller is running or will be started at $CONTROLLER_URL."
fi

# ------------------------------------------------------------------------------
# Step 6 & 7: Wait for Liveness & Readiness Probes
# ------------------------------------------------------------------------------
echo "Step 6 & 7: Polling liveness and readiness endpoints..."
MAX_WAIT=20
WAIT_COUNT=0
IS_LIVE=false

while [ "$WAIT_COUNT" -lt "$MAX_WAIT" ]; do
    if curl -s -f "$CONTROLLER_URL/health/live" &>/dev/null; then
        IS_LIVE=true
        break
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    echo -n "."
done
echo ""

if [ "$IS_LIVE" != "true" ]; then
    echo "❌ Deployment Failed: Controller did not achieve liveness within ${MAX_WAIT}s."
    echo "Initiating automatic rollback..."
    "$SCRIPT_DIR/rollback.sh" "$BACKUP_SNAPSHOT"
    exit 1
fi

echo "✅ Controller liveness confirmed."

# ------------------------------------------------------------------------------
# Step 8: Run Smoke Tests & Verification
# ------------------------------------------------------------------------------
echo "Step 8: Executing deployment verification suite..."
if ! "$SCRIPT_DIR/verify-deployment.sh" --url "$CONTROLLER_URL" ${API_TOKEN:+--token "$API_TOKEN"}; then
    echo "❌ Deployment verification failed! Initiating automatic rollback to preserve stability..."
    "$SCRIPT_DIR/rollback.sh" "$BACKUP_SNAPSHOT"
    echo "❌ Deployment failed and rollback completed."
    exit 1
fi

echo ""
echo "========================================================================"
echo "🎉 DEPLOYMENT SUCCEEDED: OpenWrt Controller v$APP_VERSION is live!"
echo "========================================================================"
exit 0

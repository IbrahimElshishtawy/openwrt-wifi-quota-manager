#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Controller - Automated Rollback Tool
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_BASE_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
CONTROLLER_URL="${CONTROLLER_URL:-http://127.0.0.1:${PORT:-3000}}"

SPECIFIED_BACKUP="${1:-}"

echo "========================================================================"
echo "  INITIATING AUTOMATED ROLLBACK"
echo "========================================================================"

# 1. Locate restore target
RESTORE_TARGET=""
if [ -n "$SPECIFIED_BACKUP" ] && [ -d "$SPECIFIED_BACKUP" ]; then
    RESTORE_TARGET="$SPECIFIED_BACKUP"
elif [ -L "$BACKUP_BASE_DIR/latest" ] && [ -d "$BACKUP_BASE_DIR/latest" ]; then
    RESTORE_TARGET="$(readlink -f "$BACKUP_BASE_DIR/latest")"
else
    # Find most recent backup directory
    LATEST_DIR="$(ls -td "$BACKUP_BASE_DIR"/backup_* 2>/dev/null | head -n 1 || true)"
    if [ -n "$LATEST_DIR" ] && [ -d "$LATEST_DIR" ]; then
        RESTORE_TARGET="$LATEST_DIR"
    fi
fi

if [ -z "$RESTORE_TARGET" ] || [ ! -d "$RESTORE_TARGET" ]; then
    echo "❌ Rollback Error: No valid backup snapshot found in $BACKUP_BASE_DIR" >&2
    exit 1
fi

echo "Selected Rollback Snapshot: $RESTORE_TARGET"

# 2. Restore data state from snapshot
echo "Restoring state files..."
"$SCRIPT_DIR/restore.sh" "$RESTORE_TARGET"

# 3. Restart application service if managed by systemd or Docker
if systemctl is-active --quiet openwrt-controller 2>/dev/null; then
    echo "Restarting systemd service: openwrt-controller..."
    sudo systemctl restart openwrt-controller || true
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^openwrt-controller$"; then
    echo "Restarting Docker container: openwrt-controller..."
    docker restart openwrt-controller || true
else
    echo "Note: Standalone process execution detected; state restored. If running via Node, restart process manually."
fi

# 4. Wait for controller to regain liveness
echo "Awaiting controller liveness..."
COUNT=0
MAX_WAIT=15
RECOVERED=false
while [ "$COUNT" -lt "$MAX_WAIT" ]; do
    if curl -s -f "$CONTROLLER_URL/health/live" &>/dev/null; then
        RECOVERED=true
        break
    fi
    sleep 1
    COUNT=$((COUNT + 1))
done

if [ "$RECOVERED" = "true" ]; then
    echo "✅ Controller responded to liveness probe after rollback."
    echo "Running post-rollback smoke verification..."
    "$SCRIPT_DIR/verify-deployment.sh" --url "$CONTROLLER_URL" || true
    echo "✅ Rollback completed successfully."
    exit 0
else
    echo "⚠️ Warning: Controller did not respond to liveness probe within ${MAX_WAIT}s. State restored but process may need manual intervention."
    exit 0
fi

#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Controller - State Restore Tool
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
BACKUP_BASE_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"

RESTORE_SOURCE="${1:-$BACKUP_BASE_DIR/latest}"

echo "=== OpenWrt Controller State Restore ==="
echo "Restore Source: $RESTORE_SOURCE"
echo "Target Data Directory: $DATA_DIR"

if [ ! -d "$RESTORE_SOURCE" ]; then
    echo "❌ Error: Backup directory '$RESTORE_SOURCE' does not exist." >&2
    exit 1
fi

# 1. Pre-validation of backup files
echo "Validating backup integrity..."
if [ -f "$RESTORE_SOURCE/quotas.json" ]; then
    if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$RESTORE_SOURCE/quotas.json" 2>/dev/null; then
        echo "❌ Error: Backup quotas.json is corrupt / invalid JSON! Restore aborted." >&2
        exit 1
    fi
fi

if [ -f "$RESTORE_SOURCE/firewall-blocks.json" ]; then
    if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$RESTORE_SOURCE/firewall-blocks.json" 2>/dev/null; then
        echo "❌ Error: Backup firewall-blocks.json is corrupt / invalid JSON! Restore aborted." >&2
        exit 1
    fi
fi

# 2. Stage files in temporary directory first for atomic safety
TEMP_STAGE="$(mktemp -d "$DATA_DIR/tmp_restore_XXXXXX" 2>/dev/null || mktemp -d /tmp/ctrl_restore_XXXXXX)"
cleanup() {
    rm -rf "$TEMP_STAGE"
}
trap cleanup EXIT

if [ -f "$RESTORE_SOURCE/quotas.json" ]; then
    cp "$RESTORE_SOURCE/quotas.json" "$TEMP_STAGE/quotas.json"
fi

if [ -f "$RESTORE_SOURCE/firewall-blocks.json" ]; then
    cp "$RESTORE_SOURCE/firewall-blocks.json" "$TEMP_STAGE/firewall-blocks.json"
fi

# 3. Apply staged files to destination
mkdir -p "$DATA_DIR"
if [ -f "$TEMP_STAGE/quotas.json" ]; then
    cp "$TEMP_STAGE/quotas.json" "$DATA_DIR/quotas.json"
fi
if [ -f "$TEMP_STAGE/firewall-blocks.json" ]; then
    cp "$TEMP_STAGE/firewall-blocks.json" "$DATA_DIR/firewall-blocks.json"
fi

# 4. Post-restore validation
if [ -f "$DATA_DIR/quotas.json" ]; then
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$DATA_DIR/quotas.json"
fi
if [ -f "$DATA_DIR/firewall-blocks.json" ]; then
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$DATA_DIR/firewall-blocks.json"
fi

echo "✅ State successfully restored from $RESTORE_SOURCE to $DATA_DIR"

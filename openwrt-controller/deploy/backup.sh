#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Controller - State Backup Tool
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
BACKUP_BASE_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"

mkdir -p "$BACKUP_BASE_DIR"

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%S")_$$"
TARGET_BACKUP_DIR="$BACKUP_BASE_DIR/backup_$TIMESTAMP"

# Stage in a temporary directory to ensure atomic backup creation
STAGE_DIR="$(mktemp -d "$BACKUP_BASE_DIR/tmp_backup_XXXXXX")"
cleanup() {
    rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

echo "=== OpenWrt Controller State Backup ==="
echo "Source Data Directory: $DATA_DIR"
echo "Target Backup Location: $TARGET_BACKUP_DIR"

# Check if data directory exists
if [ ! -d "$DATA_DIR" ]; then
    echo "⚠️ Warning: Data directory $DATA_DIR does not exist. Creating empty target backup."
    echo "{}" > "$STAGE_DIR/metadata.json"
    mv "$STAGE_DIR" "$TARGET_BACKUP_DIR"
    ln -sfn "$TARGET_BACKUP_DIR" "$BACKUP_BASE_DIR/latest"
    echo "✅ Empty state recorded at $TARGET_BACKUP_DIR"
    echo "$TARGET_BACKUP_DIR"
    exit 0
fi

COPIED_FILES=0

# Backup quotas.json if present
if [ -f "$DATA_DIR/quotas.json" ]; then
    # Validate JSON syntax before copying
    if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$DATA_DIR/quotas.json" 2>/dev/null; then
        echo "❌ Error: $DATA_DIR/quotas.json is corrupt / invalid JSON! Aborting backup." >&2
        exit 1
    fi
    cp "$DATA_DIR/quotas.json" "$STAGE_DIR/quotas.json"
    COPIED_FILES=$((COPIED_FILES + 1))
fi

# Backup firewall-blocks.json if present
if [ -f "$DATA_DIR/firewall-blocks.json" ]; then
    # Validate JSON syntax before copying
    if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" "$DATA_DIR/firewall-blocks.json" 2>/dev/null; then
        echo "❌ Error: $DATA_DIR/firewall-blocks.json is corrupt / invalid JSON! Aborting backup." >&2
        exit 1
    fi
    cp "$DATA_DIR/firewall-blocks.json" "$STAGE_DIR/firewall-blocks.json"
    COPIED_FILES=$((COPIED_FILES + 1))
fi

# Generate metadata manifest
node -e '
const fs = require("fs");
const crypto = require("crypto");
const path = process.argv[1];
const manifest = {
  timestamp: new Date().toISOString(),
  files: {}
};
for (const file of ["quotas.json", "firewall-blocks.json"]) {
  const fullPath = path + "/" + file;
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath);
    manifest.files[file] = {
      size: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex")
    };
  }
}
fs.writeFileSync(path + "/metadata.json", JSON.stringify(manifest, null, 2));
' "$STAGE_DIR"

# Move validated staged backup to final destination
mv "$STAGE_DIR" "$TARGET_BACKUP_DIR"

# Maintain pointer to latest backup
ln -sfn "$TARGET_BACKUP_DIR" "$BACKUP_BASE_DIR/latest"

echo "✅ Backup successfully created at: $TARGET_BACKUP_DIR"
echo "  Files backed up: $COPIED_FILES"
echo "  Latest symlink updated: $BACKUP_BASE_DIR/latest"
echo "$TARGET_BACKUP_DIR"

#!/usr/bin/env bash
# ==============================================================================
# OpenWrt Wi-Fi Quota Manager - Development Startup Script (dev-up.sh)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================================================"
echo "🚀 Starting OpenWrt Wi-Fi Quota Manager System"
echo "========================================================================"

# 1. Check & start Docker container
cd "$ROOT_DIR/openwrt-controller"

if docker ps --format '{{.Names}}' | grep -q "^openwrt-controller$"; then
    echo "✅ OpenWrt Controller container is already running."
else
    echo "📦 Starting OpenWrt Controller via Docker Compose..."
    docker compose -f deploy/docker/docker-compose.yml up -d
fi

# 2. Wait for health endpoint
CONTROLLER_URL="http://127.0.0.1:3050"
echo "⏳ Waiting for Controller health endpoint ($CONTROLLER_URL/health/ready)..."

HEALTHY=0
for i in {1..15}; do
    if curl -s "$CONTROLLER_URL/health/ready" | grep -q '"ready":true'; then
        HEALTHY=1
        break
    fi
    sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
    echo "✅ Controller is Healthy & Ready on port 3050!"
else
    echo "⚠️ Controller started but readiness probe is still pending."
fi

# 3. Print system status and instructions
"$SCRIPT_DIR/dev-check.sh"

#!/usr/bin/env python3
"""
================================================================================
OpenWrt Wi-Fi Quota Manager — Interactive Full-Stack Simulator & Client Bridge
================================================================================
This script provides an all-in-one local simulation environment:
  1. 🌐 Simulated OpenWrt Router (Traffic Generation, nlbwmon & nftables emulation)
  2. 🛡️ Real-Time Quota Enforcement & Instant Firewall Blocking
  3. 🔗 REST API compatibility for Flutter Mobile/Desktop Client & Controller
  4. 📊 Live Real-Time Terminal & Web Dashboard
  5. 📱 Flutter Client Launcher & Auto-Connect
"""

import argparse
import http.server
import json
import os
import re
import socket
import socketserver
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

ROOT_DIR = Path(__file__).resolve().parent
CONFIG_FILE = ROOT_DIR / "openwrt" / "config" / "devices.json"
FLUTTER_DIR = ROOT_DIR / "flutter_client"

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

# ANSI Colors for terminal UI
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    BG_RED = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"
    GRAY = "\033[90m"


def format_bytes(bytes_val: float) -> str:
    """Format bytes into readable string (B, KB, MB, GB)."""
    units = ["B", "KB", "MB", "GB", "TB"]
    unit_index = 0
    val = float(bytes_val)
    while val >= 1024.0 and unit_index < len(units) - 1:
        val /= 1024.0
        unit_index += 1
    return f"{val:.2f} {units[unit_index]}"


def format_speed(bytes_per_sec: float) -> str:
    """Format bytes per second into speed string."""
    return f"{format_bytes(bytes_per_sec)}/s"


# ==============================================================================
# Router Simulator Core State & Traffic Engine
# ==============================================================================
class OpenWrtRouterSimulator:
    """
    Emulates OpenWrt router traffic counting (nlbwmon) and firewall access (nftables).
    """

    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.lock = threading.RLock()
        self.devices: Dict[str, Dict[str, Any]] = {}
        self.blocked_set: set[str] = set()  # Simulated nftables quota_blocked set
        self.event_logs: List[str] = []
        self.traffic_active = True
        self.speed_multiplier = 1.0
        self.load_initial_devices()

    def log_event(self, message: str, level: str = "INFO"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        prefix = {
            "INFO": f"{Colors.BLUE}[INFO]{Colors.RESET}",
            "WARN": f"{Colors.YELLOW}[WARN]{Colors.RESET}",
            "ALERT": f"{Colors.MAGENTA}[ALERT]{Colors.RESET}",
            "BLOCK": f"{Colors.RED}{Colors.BOLD}[FIREWALL BLOCKED]{Colors.RESET}",
            "UNBLOCK": f"{Colors.GREEN}[UNBLOCKED]{Colors.RESET}",
        }.get(level, f"[{level}]")
        formatted = f"[{timestamp}] {prefix} {message}"
        with self.lock:
            self.event_logs.append(formatted)
            if len(self.event_logs) > 30:
                self.event_logs.pop(0)

    def load_initial_devices(self):
        default_devices = [
            {"mac": "AA:BB:CC:DD:EE:FF", "name": "Ahmed Phone", "ip": "192.168.50.101", "quota_gb": 20.0, "enabled": True},
            {"mac": "11:22:33:44:55:66", "name": "Living Room TV", "ip": "192.168.50.102", "quota_gb": 50.0, "enabled": True},
            {"mac": "66:77:88:99:AA:BB", "name": "Guest Laptop", "ip": "192.168.50.103", "quota_gb": 10.0, "enabled": False},
            {"mac": "00:11:22:33:44:55", "name": "Work PC", "ip": "192.168.50.104", "quota_gb": 40.0, "enabled": True},
        ]

        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    file_devices = cfg.get("devices", [])
                    if file_devices:
                        default_devices = []
                        ip_counter = 101
                        for d in file_devices:
                            default_devices.append({
                                "mac": d.get("mac", "").upper(),
                                "name": d.get("name", "Unknown Device"),
                                "ip": f"192.168.50.{ip_counter}",
                                "quota_gb": float(d.get("quota_gb", 20.0)),
                                "enabled": d.get("enabled", True),
                            })
                            ip_counter += 1
            except Exception as e:
                self.log_event(f"Error loading devices.json: {e}, using defaults", "WARN")

        with self.lock:
            for d in default_devices:
                mac = d["mac"].upper()
                self.devices[mac] = {
                    "mac": mac,
                    "name": d["name"],
                    "ip": d["ip"],
                    "quota_gb": float(d["quota_gb"]),
                    "download_bytes": 0.0,
                    "upload_bytes": 0.0,
                    "download_speed": 0.0,
                    "upload_speed": 0.0,
                    "enabled": d["enabled"],
                    "warning_80": False,
                    "warning_90": False,
                    "warning_95": False,
                    "blocked": not d["enabled"],
                }
                if not d["enabled"]:
                    self.blocked_set.add(mac)

        self.log_event(f"Loaded {len(self.devices)} simulated Wi-Fi devices into router memory.")

    def add_traffic(self, mac: str, dl_mb: float, ul_mb: float = 0.0):
        """Inject instant traffic burst for a specific device."""
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"

            dl_bytes = dl_mb * (1024 ** 2)
            ul_bytes = ul_mb * (1024 ** 2)
            dev["download_bytes"] += dl_bytes
            dev["upload_bytes"] += ul_bytes
            self._evaluate_quota(dev)
        return True, "Traffic added"

    def set_quota(self, mac: str, quota_gb: float):
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"
            dev["quota_gb"] = float(quota_gb)
            self._evaluate_quota(dev)
        self.log_event(f"Quota for {dev['name']} ({mac}) set to {quota_gb:.1f} GB")
        return True, "Quota updated"

    def block_device(self, mac: str, reason: str = "Manual Block"):
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"
            dev["blocked"] = True
            dev["enabled"] = False
            self.blocked_set.add(mac)
        self.log_event(f"Device {dev['name']} ({mac}) is BLOCKED at firewall [{reason}]", "BLOCK")
        return True, "Device blocked"

    def unblock_device(self, mac: str):
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"
            dev["blocked"] = False
            dev["enabled"] = True
            self.blocked_set.discard(mac)
        self.log_event(f"Device {dev['name']} ({mac}) UNBLOCKED & enabled in nftables", "UNBLOCK")
        return True, "Device unblocked"

    def reset_quotas(self):
        with self.lock:
            for dev in self.devices.values():
                dev["download_bytes"] = 0.0
                dev["upload_bytes"] = 0.0
                dev["warning_80"] = False
                dev["warning_90"] = False
                dev["warning_95"] = False
                if dev["enabled"]:
                    dev["blocked"] = False
            self.blocked_set = {mac for mac, d in self.devices.items() if not d["enabled"]}
        self.log_event("🔄 Billing Period Reset: All data consumption cleared, active devices unblocked!", "INFO")
        return True, "Reset completed"

    def _evaluate_quota(self, dev: Dict[str, Any]):
        """Check quota thresholds and apply firewall block if 100% exceeded."""
        total_bytes = dev["download_bytes"] + dev["upload_bytes"]
        quota_bytes = dev["quota_gb"] * (1024 ** 3)
        pct = (total_bytes / quota_bytes * 100.0) if quota_bytes > 0 else 0.0
        mac = dev["mac"]

        # Check threshold warnings
        if pct >= 80.0 and not dev["warning_80"]:
            dev["warning_80"] = True
            self.log_event(f"⚠️ {dev['name']} reached 80% quota ({format_bytes(total_bytes)}/{dev['quota_gb']}GB)", "WARN")

        if pct >= 90.0 and not dev["warning_90"]:
            dev["warning_90"] = True
            self.log_event(f"🚨 {dev['name']} reached 90% quota ({format_bytes(total_bytes)}/{dev['quota_gb']}GB)", "ALERT")

        if pct >= 95.0 and not dev["warning_95"]:
            dev["warning_95"] = True
            self.log_event(f"⛔ {dev['name']} reached 95% quota ({format_bytes(total_bytes)}/{dev['quota_gb']}GB)", "ALERT")

        # Quota Exceeded -> Immediate Firewall Block
        if pct >= 100.0 and not dev["blocked"]:
            dev["blocked"] = True
            self.blocked_set.add(mac)
            self.log_event(
                f"🚨 QUOTA EXHAUSTED: {dev['name']} exceeded 100% ({format_bytes(total_bytes)}/{dev['quota_gb']}GB) -> BLOCKED by nftables!",
                "BLOCK"
            )

    def traffic_simulation_tick(self):
        """Simulate real-world Wi-Fi background traffic growth."""
        import random
        with self.lock:
            if not self.traffic_active:
                return

            for dev in self.devices.values():
                if dev["blocked"]:
                    # Blocked devices cannot transmit internet traffic
                    dev["download_speed"] = 0.0
                    dev["upload_speed"] = 0.0
                    continue

                # Normal device activity: generate random browsing/streaming traffic
                # e.g., between 50 KB/s and 1.5 MB/s
                base_speed = random.uniform(150_000, 1_200_000) * self.speed_multiplier
                dl_speed = base_speed * random.uniform(0.7, 1.3)
                ul_speed = base_speed * random.uniform(0.05, 0.2)

                dev["download_speed"] = dl_speed
                dev["upload_speed"] = ul_speed
                dev["download_bytes"] += dl_speed
                dev["upload_bytes"] += ul_speed

                self._evaluate_quota(dev)

    def get_devices_summary(self) -> List[Dict[str, Any]]:
        with self.lock:
            res = []
            for d in self.devices.values():
                tot_bytes = d["download_bytes"] + d["upload_bytes"]
                tot_gb = tot_bytes / (1024 ** 3)
                quota_gb = d["quota_gb"]
                pct = (tot_gb / quota_gb * 100.0) if quota_gb > 0 else 0.0
                rem_gb = max(0.0, quota_gb - tot_gb)

                status = "blocked" if d["blocked"] else ("warning" if pct >= 80 else "allowed")
                res.append({
                    "mac": d["mac"],
                    "name": d["name"],
                    "ip": d["ip"],
                    "quota_gb": quota_gb,
                    "usage_gb": round(tot_gb, 3),
                    "download_gb": round(d["download_bytes"] / (1024 ** 3), 3),
                    "upload_gb": round(d["upload_bytes"] / (1024 ** 3), 3),
                    "remaining_gb": round(rem_gb, 3),
                    "usage_percentage": round(pct, 1),
                    "download_speed_bps": round(d["download_speed"], 1),
                    "upload_speed_bps": round(d["upload_speed"], 1),
                    "enabled": d["enabled"],
                    "is_blocked": d["blocked"],
                    "status": status,
                    "formatted_usage": format_bytes(tot_bytes),
                    "formatted_speed": format_speed(d["download_speed"] + d["upload_speed"]),
                })
            return res


# ==============================================================================
# HTTP Server (Serving OpenWrt API & Flutter Client API & Web Dashboard)
# ==============================================================================
class SimulatorHTTPHandler(http.server.BaseHTTPRequestHandler):
    simulator: OpenWrtRouterSimulator

    def handle_expect_100(self) -> bool:
        self.send_response_only(100)
        self.end_headers()
        return True

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress routine GET logs to keep terminal dashboard clean
        return

    def _send_json(self, status: int, data: Any):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key")
        self.send_header("Connection", "close")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        # 1. Health Endpoints
        if path in ["/health", "/api/health", "/api/health/live", "/health/live"]:
            self._send_json(200, {
                "status": "alive",
                "service": "openwrt-simulator",
                "timestamp": datetime.now().isoformat(),
                "uptimeSeconds": 100,
                "ready": True
            })
            return

        if path in ["/health/ready", "/api/health/ready"]:
            self._send_json(200, {
                "status": "ready",
                "ready": True,
                "service": "openwrt-simulator",
                "timestamp": datetime.now().isoformat(),
                "subsystems": {
                    "routerConnectivity": {"ready": True, "status": "simulated_ok"},
                    "firewall": {"ready": True, "status": "nftables_simulated_ok"},
                    "quotaStorage": {"ready": True, "status": "healthy"},
                    "monitor": {"ready": True, "state": "running"}
                }
            })
            return

        # 2. Devices Endpoints
        if path in ["/devices", "/api/devices"]:
            devices = self.simulator.get_devices_summary()
            self._send_json(200, {
                "status": "success",
                "count": len(devices),
                "devices": devices
            })
            return

        # 3. Quotas Endpoints
        if path in ["/quotas", "/api/quotas"]:
            devices = self.simulator.get_devices_summary()
            self._send_json(200, {
                "status": "success",
                "count": len(devices),
                "quotas": [{
                    "mac": d["mac"],
                    "quota_gb": d["quota_gb"],
                    "usage_gb": d["usage_gb"],
                    "remaining_gb": d["remaining_gb"],
                    "percentage": d["usage_percentage"],
                    "status": d["status"]
                } for d in devices]
            })
            return

        # 4. Firewall Blocks Endpoints
        if path in ["/blocks", "/api/blocks", "/api/firewall/blocked"]:
            with self.simulator.lock:
                blocked = list(self.simulator.blocked_set)
            self._send_json(200, {
                "status": "success",
                "count": len(blocked),
                "blocked": blocked
            })
            return

        # 5. Interactive HTML Web Dashboard
        if path in ["/", "/dashboard"]:
            self._send_html_dashboard()
            return

        self._send_json(404, {"error": "Not Found", "path": path})

    def do_POST(self):
        path = urlparse(self.path).path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        # Reset Quotas
        if path in ["/reset", "/api/reset", "/api/quotas/reset"]:
            ok, msg = self.simulator.reset_quotas()
            self._send_json(200, {"status": "success", "message": msg})
            return

        # Block Device
        match_block = re.match(r"^/(?:api/)?devices/([0-9a-fA-F:]{17})/block$", path)
        if match_block or path in ["/api/blocks", "/blocks"]:
            mac = match_block.group(1) if match_block else payload.get("mac", "")
            ok, msg = self.simulator.block_device(mac, reason=payload.get("reason", "API Request"))
            self._send_json(200 if ok else 400, {"status": "success" if ok else "error", "message": msg})
            return

        # Unblock Device
        match_unblock = re.match(r"^/(?:api/)?devices/([0-9a-fA-F:]{17})/unblock$", path)
        if match_unblock:
            mac = match_unblock.group(1)
            ok, msg = self.simulator.unblock_device(mac)
            self._send_json(200 if ok else 400, {"status": "success" if ok else "error", "message": msg})
            return

        # Traffic Burst Simulation
        if path in ["/api/simulate/burst", "/burst"]:
            mac = payload.get("mac", "")
            dl_mb = float(payload.get("download_mb", 1000))
            ok, msg = self.simulator.add_traffic(mac, dl_mb)
            self._send_json(200 if ok else 400, {"status": "success" if ok else "error", "message": msg})
            return

        self._send_json(404, {"error": "Not Found", "path": path})

    def _send_html_dashboard(self):
        html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenWrt Wi-Fi Quota Simulator & Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 1000px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 24px; color: #38bdf8; }
    .badge { padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: bold; background: #22c55e; color: #000; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td { padding: 12px 14px; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; font-size: 13px; text-transform: uppercase; }
    .progress-bar-bg { background: #334155; border-radius: 6px; height: 10px; width: 100%; overflow: hidden; margin-top: 6px; }
    .progress-bar-fill { height: 100%; border-radius: 6px; transition: width 0.3s ease; }
    .btn { background: #0284c7; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; margin-right: 4px; }
    .btn:hover { background: #0369a1; }
    .btn-danger { background: #ef4444; }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: #22c55e; color: #000; }
    .btn-success:hover { background: #16a34a; }
    .status-allowed { color: #4ade80; font-weight: bold; }
    .status-warning { color: #facc15; font-weight: bold; }
    .status-blocked { color: #f87171; font-weight: bold; }
    .log-box { background: #090d16; font-family: monospace; font-size: 12px; padding: 12px; border-radius: 8px; max-height: 180px; overflow-y: auto; color: #a5f3fc; border: 1px solid #1e293b; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>OpenWrt Wi-Fi Quota Simulator</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Real-time Quota Metering & Firewall Blocking Simulator</p>
      </div>
      <div>
        <span class="badge">🟢 ROUTER ONLINE</span>
      </div>
    </header>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 18px;">Active Connected Wi-Fi Devices</h2>
        <button class="btn btn-success" onclick="resetQuotas()">🔄 Reset All Quotas</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>IP / MAC</th>
            <th>Speed</th>
            <th>Quota Consumption</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="devices-table">
          <tr><td colspan="6" style="text-align: center; color: #94a3b8;">Loading devices...</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2 style="margin: 0 0 12px 0; font-size: 16px;">Live System & Firewall Events</h2>
      <div id="logs" class="log-box">Connecting to event stream...</div>
    </div>
  </div>

  <script>
    async function fetchDevices() {
      try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        const tbody = document.getElementById('devices-table');
        tbody.innerHTML = '';
        
        data.devices.forEach(d => {
          let barColor = '#38bdf8';
          let statusClass = 'status-allowed';
          let statusText = 'ALLOWED';

          if (d.is_blocked) {
            barColor = '#ef4444';
            statusClass = 'status-blocked';
            statusText = 'BLOCKED (Firewall)';
          } else if (d.usage_percentage >= 90) {
            barColor = '#f97316';
            statusClass = 'status-warning';
            statusText = 'CRITICAL (' + d.usage_percentage + '%)';
          } else if (d.usage_percentage >= 80) {
            barColor = '#eab308';
            statusClass = 'status-warning';
            statusText = 'WARNING (' + d.usage_percentage + '%)';
          }

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${d.name}</strong></td>
            <td><code style="color: #cbd5e1;">${d.ip}</code><br><small style="color: #64748b;">${d.mac}</small></td>
            <td><span style="color: #38bdf8; font-weight: 500;">${d.formatted_speed}</span></td>
            <td style="min-width: 180px;">
              <div style="display: flex; justify-content: space-between; font-size: 12px;">
                <span>${d.usage_gb.toFixed(1)} GB / ${d.quota_gb.toFixed(1)} GB</span>
                <span><strong>${d.usage_percentage}%</strong></span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${Math.min(100, d.usage_percentage)}%; background: ${barColor};"></div>
              </div>
            </td>
            <td><span class="${statusClass}">${statusText}</span></td>
            <td>
              ${d.is_blocked ? 
                `<button class="btn btn-success" onclick="unblock('${d.mac}')">Unblock</button>` : 
                `<button class="btn btn-danger" onclick="block('${d.mac}')">Block</button>`
              }
              <button class="btn" onclick="burst('${d.mac}', 3000)">+3GB Burst</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      } catch (e) {
        console.error(e);
      }
    }

    async function block(mac) {
      await fetch('/api/devices/' + mac + '/block', { method: 'POST', body: JSON.stringify({ reason: 'Web Dashboard' }) });
      fetchDevices();
    }

    async function unblock(mac) {
      await fetch('/api/devices/' + mac + '/unblock', { method: 'POST' });
      fetchDevices();
    }

    async function burst(mac, mb) {
      await fetch('/api/simulate/burst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac: mac, download_mb: mb }) });
      fetchDevices();
    }

    async function resetQuotas() {
      await fetch('/api/quotas/reset', { method: 'POST' });
      fetchDevices();
    }

    setInterval(fetchDevices, 1500);
    fetchDevices();
  </script>
</body>
</html>"""
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Connection", "close")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()


# ==============================================================================
# Terminal Live Dashboard & Command Line Loop
# ==============================================================================
def render_terminal_dashboard(sim: OpenWrtRouterSimulator, port: int):
    devices = sim.get_devices_summary()
    os.system("clear" if os.name == "posix" else "cls")

    print(f"{Colors.BOLD}{Colors.CYAN}================================================================================{Colors.RESET}")
    print(f"{Colors.BOLD}🚀 OPENWRT WI-FI QUOTA MANAGER — LIVE REAL-TIME DASHBOARD & SIMULATOR{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}================================================================================{Colors.RESET}")
    print(f"📡 {Colors.BOLD}Simulator Server:{Colors.RESET} {Colors.GREEN}http://127.0.0.1:{port}{Colors.RESET} | Web UI: {Colors.CYAN}http://127.0.0.1:{port}/dashboard{Colors.RESET}")
    print(f"🛡️  {Colors.BOLD}Firewall Enforcement:{Colors.RESET} {Colors.GREEN}Active (Auto-block at 100% quota){Colors.RESET}")
    print("-" * 80)

    # Header
    print(f"{Colors.BOLD}{'Device Name':<17} {'MAC Address':<18} {'Speed':<12} {'Usage / Limit':<18} {'Progress':<14} {'Status'}{Colors.RESET}")
    print("-" * 80)

    for d in devices:
        name = d["name"][:16]
        mac = d["mac"]
        speed = d["formatted_speed"]
        usage_str = f"{d['usage_gb']:>4.1f} / {d['quota_gb']:>4.1f} GB"
        pct = d["usage_percentage"]

        # Progress bar
        bar_len = 8
        filled = int(min(1.0, pct / 100.0) * bar_len)
        empty = bar_len - filled

        if d["is_blocked"]:
            color = Colors.RED
            status_text = f"{Colors.BG_RED}{Colors.WHITE} BLOCKED {Colors.RESET}"
        elif pct >= 90:
            color = Colors.YELLOW
            status_text = f"{Colors.YELLOW}CRITICAL{Colors.RESET}"
        elif pct >= 80:
            color = Colors.YELLOW
            status_text = f"{Colors.YELLOW}WARNING {Colors.RESET}"
        else:
            color = Colors.GREEN
            status_text = f"{Colors.GREEN}ALLOWED {Colors.RESET}"

        bar = f"{color}[{'█' * filled}{'░' * empty}] {pct:>5.1f}%{Colors.RESET}"
        print(f"{name:<17} {mac:<18} {speed:<12} {usage_str:<18} {bar:<22} {status_text}")

    print("-" * 80)
    print(f"{Colors.BOLD}📋 Recent Events & Firewall Actions:{Colors.RESET}")
    with sim.lock:
        recent_logs = sim.event_logs[-4:]
    if recent_logs:
        for log in recent_logs:
            print(f"  {log}")
    else:
        print("  (Awaiting network activity...)")

    print("-" * 80)
    print(f"{Colors.GRAY}Commands: [b <mac>] Block | [u <mac>] Unblock | [burst <mac> <MB>] Add Traffic | [reset] Reset | [c] Client | [q] Exit{Colors.RESET}")


def run_traffic_worker(sim: OpenWrtRouterSimulator):
    while sim.traffic_active:
        sim.traffic_simulation_tick()
        time.sleep(1.0)


def launch_flutter_client(device: str = "linux"):
    """Launch the Flutter client application in a subprocess."""
    print(f"\n{Colors.CYAN}🚀 Launching Flutter Client ({device})...{Colors.RESET}")
    cmd = ["flutter", "run", "-d", device]
    try:
        subprocess.Popen(cmd, cwd=str(FLUTTER_DIR))
    except Exception as e:
        print(f"{Colors.RED}❌ Failed to start flutter: {e}{Colors.RESET}")


def interactive_cli_loop(sim: OpenWrtRouterSimulator, port: int, headless: bool = False):
    """Handles user input in terminal while simulation runs."""
    if headless:
        print(f"{Colors.GREEN}Simulator running in headless/daemon mode.{Colors.RESET}")
        print(f"📡 API active on http://127.0.0.1:{port} | Web Dashboard: http://127.0.0.1:{port}/dashboard")
        try:
            while sim.traffic_active:
                time.sleep(1)
        except KeyboardInterrupt:
            sim.traffic_active = False
        return

    while sim.traffic_active:
        try:
            render_terminal_dashboard(sim, port)
            try:
                user_input = input(f"\n{Colors.BOLD}Enter Command > {Colors.RESET}").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not user_input:
                continue

            parts = user_input.split()
            cmd = parts[0].lower()

            if cmd in ["q", "quit", "exit"]:
                print("\n🛑 Shutting down simulator...")
                sim.traffic_active = False
                break

            elif cmd in ["r", "reset"]:
                sim.reset_quotas()
                time.sleep(1)

            elif cmd in ["b", "block"]:
                if len(parts) < 2:
                    print("Usage: b <mac or name>")
                    time.sleep(1.5)
                    continue
                target = parts[1].upper()
                # Find by MAC or Name
                found_mac = None
                with sim.lock:
                    for m, d in sim.devices.items():
                        if m.startswith(target) or target.lower() in d["name"].lower():
                            found_mac = m
                            break
                if found_mac:
                    sim.block_device(found_mac, reason="Terminal Operator")
                else:
                    print(f"Device '{target}' not found")
                time.sleep(1.5)

            elif cmd in ["u", "unblock"]:
                if len(parts) < 2:
                    print("Usage: u <mac or name>")
                    time.sleep(1.5)
                    continue
                target = parts[1].upper()
                found_mac = None
                with sim.lock:
                    for m, d in sim.devices.items():
                        if m.startswith(target) or target.lower() in d["name"].lower():
                            found_mac = m
                            break
                if found_mac:
                    sim.unblock_device(found_mac)
                else:
                    print(f"Device '{target}' not found")
                time.sleep(1.5)

            elif cmd in ["burst", "add"]:
                if len(parts) < 3:
                    print("Usage: burst <mac or name> <MB>")
                    time.sleep(1.5)
                    continue
                target = parts[1]
                mb = float(parts[2])
                found_mac = None
                with sim.lock:
                    for m, d in sim.devices.items():
                        if m.startswith(target.upper()) or target.lower() in d["name"].lower():
                            found_mac = m
                            break
                if found_mac:
                    sim.add_traffic(found_mac, dl_mb=mb)
                else:
                    print(f"Device '{target}' not found")
                time.sleep(1.5)

            elif cmd in ["c", "client", "flutter"]:
                dev_target = parts[1] if len(parts) > 1 else "linux"
                launch_flutter_client(dev_target)
                time.sleep(2)

            elif cmd in ["h", "help"]:
                print("\nAvailable Commands:")
                print("  b <mac/name>            : Immediately block device at firewall")
                print("  u <mac/name>            : Unblock device")
                print("  burst <mac/name> <MB>   : Add heavy traffic burst (e.g. burst ahmed 4000)")
                print("  r / reset               : Reset billing cycle & clear blocks")
                print("  c / client [linux|chrome] : Launch Flutter Client application")
                print("  q / exit                : Exit simulator")
                input("\nPress Enter to return...")

        except (KeyboardInterrupt, EOFError):
            print("\n🛑 Exiting simulator...")
            sim.traffic_active = False
            break


# ==============================================================================
# Main Entry Point
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="OpenWrt Wi-Fi Quota Manager — Interactive Simulator & Client Bridge"
    )
    parser.add_argument("--port", type=int, default=8080, help="HTTP Server port (default: 8080)")
    parser.add_argument("--client", action="store_true", help="Automatically launch Flutter client on start")
    parser.add_argument("--device", type=str, default="linux", choices=["linux", "chrome"], help="Flutter target device (default: linux)")
    parser.add_argument("--headless", action="store_true", help="Run in headless/daemon mode without interactive input")
    args = parser.parse_args()

    # Initialize Simulator Core
    simulator = OpenWrtRouterSimulator(config_path=CONFIG_FILE)

    # Bind Simulator to HTTP Server
    SimulatorHTTPHandler.simulator = simulator
    server_address = ("0.0.0.0", args.port)

    try:
        httpd = ThreadedHTTPServer(server_address, SimulatorHTTPHandler)
    except OSError as e:
        print(f"{Colors.RED}❌ Could not bind to port {args.port}: {e}{Colors.RESET}")
        print(f"💡 Hint: Another process is using port {args.port}.")
        print(f"   To free it, run: fuser -k {args.port}/tcp")
        print(f"   Or run simulator on another port: python3 openwrt_simulator.py --port {args.port + 1}")
        sys.exit(1)

    # Start HTTP server thread
    http_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    http_thread.start()

    # Start background traffic generator thread
    traffic_thread = threading.Thread(target=run_traffic_worker, args=(simulator,), daemon=True)
    traffic_thread.start()

    # Optionally launch Flutter client
    if args.client:
        launch_flutter_client(args.device)

    # Run interactive terminal dashboard
    interactive_cli_loop(simulator, args.port, headless=args.headless)

    # Clean shutdown
    httpd.shutdown()
    httpd.server_close()
    print("👋 Simulator finished. Have a great day!")


if __name__ == "__main__":
    main()

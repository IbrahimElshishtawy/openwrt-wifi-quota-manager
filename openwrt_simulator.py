#!/usr/bin/env python3
"""
================================================================================
OpenWrt Wi-Fi Quota Manager — Interactive Full-Stack Simulator & Network Monitor
================================================================================
This script provides:
  1. 🌐 Simulated OpenWrt Router (Traffic Generation, nlbwmon & nftables emulation)
  2. ⚖️ Interactive Quota Distribution (ISP Package Pool Allocation)
  3. 🛡️ Strict Real-Time Quota Enforcement & Instant Packet Drop / Firewall Block
  4. 📊 Detailed Network Monitoring (Live Activity, Apps, Speeds, Packet Drops)
  5. 📱 Full REST API for Flutter Client, Controller & Interactive Web Dashboard
"""

import argparse
import http.server
import json
import os
import random
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
    BG_BLUE = "\033[44m"
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
        self.isp_total_package_gb = 250.0  # Total ISP monthly quota
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
            "QUOTA": f"{Colors.CYAN}[QUOTA ALLOC]{Colors.RESET}",
        }.get(level, f"[{level}]")
        formatted = f"[{timestamp}] {prefix} {message}"
        with self.lock:
            self.event_logs.append(formatted)
            if len(self.event_logs) > 30:
                self.event_logs.pop(0)

    def load_initial_devices(self):
        default_devices = [
            {"mac": "AA:BB:CC:DD:EE:FF", "name": "Ahmed Phone", "ip": "192.168.50.101", "quota_gb": 30.0, "enabled": True},
            {"mac": "11:22:33:44:55:66", "name": "Living Room TV", "ip": "192.168.50.102", "quota_gb": 100.0, "enabled": True},
            {"mac": "66:77:88:99:AA:BB", "name": "Guest Laptop", "ip": "192.168.50.103", "quota_gb": 20.0, "enabled": False},
            {"mac": "00:11:22:33:44:55", "name": "Work PC", "ip": "192.168.50.104", "quota_gb": 50.0, "enabled": True},
        ]

        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    pkg = cfg.get("package", {})
                    if "total_gb" in pkg:
                        self.isp_total_package_gb = float(pkg["total_gb"])

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
                    "peak_speed": 0.0,
                    "activity": "🌐 Web Browsing",
                    "connections": random.randint(5, 25),
                    "dropped_packets": 0,
                    "enabled": d["enabled"],
                    "warning_80": False,
                    "warning_90": False,
                    "warning_95": False,
                    "blocked": not d["enabled"],
                }
                if not d["enabled"]:
                    self.blocked_set.add(mac)

        self.log_event(f"Loaded {len(self.devices)} devices. ISP Package: {self.isp_total_package_gb:.1f} GB.")

    # --------------------------------------------------------------------------
    # Quota Allocation & Distribution (توزيع الكوتة)
    # --------------------------------------------------------------------------
    def distribute_equal(self) -> tuple[bool, str]:
        """Distribute ISP package equally among all enabled devices."""
        with self.lock:
            enabled_devs = [d for d in self.devices.values() if d["enabled"]]
            if not enabled_devs:
                return False, "No active devices to distribute quota to!"

            per_device = round(self.isp_total_package_gb / len(enabled_devs), 1)
            for d in enabled_devs:
                d["quota_gb"] = per_device
                self._evaluate_quota(d)

        self.log_event(f"⚖️ Equal Distribution: Allocated {per_device:.1f} GB to each of {len(enabled_devs)} devices.", "QUOTA")
        return True, f"Allocated {per_device:.1f} GB per device"

    def distribute_quotas(self, allocations: Dict[str, float]) -> tuple[bool, str]:
        """Custom distribution of quotas per device."""
        with self.lock:
            total_req = sum(allocations.values())
            if total_req > self.isp_total_package_gb:
                return False, f"Total allocated ({total_req} GB) exceeds ISP package ({self.isp_total_package_gb} GB)!"

            for mac, quota in allocations.items():
                mac = mac.upper()
                dev = self.devices.get(mac)
                if dev:
                    dev["quota_gb"] = float(quota)
                    self._evaluate_quota(dev)

        self.log_event(f"⚖️ Custom Quota Distribution applied to {len(allocations)} devices.", "QUOTA")
        return True, "Quotas successfully distributed"

    def set_quota(self, mac: str, quota_gb: float):
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"
            dev["quota_gb"] = float(quota_gb)
            self._evaluate_quota(dev)
        self.log_event(f"Quota for {dev['name']} ({mac}) set to {quota_gb:.1f} GB", "QUOTA")
        return True, "Quota updated"

    def set_isp_package(self, total_gb: float):
        with self.lock:
            self.isp_total_package_gb = float(total_gb)
        self.log_event(f"ISP Total Monthly Package set to {total_gb:.1f} GB", "QUOTA")
        return True, "ISP Package updated"

    # --------------------------------------------------------------------------
    # Traffic Generation & Enforcement
    # --------------------------------------------------------------------------
    def add_traffic(self, mac: str, dl_mb: float, ul_mb: float = 0.0):
        """Inject traffic burst strictly capped at quota limit."""
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"

            if dev["blocked"]:
                dev["dropped_packets"] += int(dl_mb * 50)
                self.log_event(f"⛔ Dropped packets: {dev['name']} is already BLOCKED by firewall!", "BLOCK")
                return False, f"Device {dev['name']} is already blocked at firewall!"

            dl_bytes = dl_mb * (1024 ** 2)
            ul_bytes = ul_mb * (1024 ** 2)
            attempted_bytes = dl_bytes + ul_bytes

            quota_bytes = dev["quota_gb"] * (1024 ** 3)
            current_total = dev["download_bytes"] + dev["upload_bytes"]
            remaining_bytes = max(0.0, quota_bytes - current_total)

            if attempted_bytes >= remaining_bytes:
                # Quota reached! Allow only up to the limit then firewall drops the rest
                dev["download_bytes"] += remaining_bytes
                dev["download_speed"] = 0.0
                dev["upload_speed"] = 0.0
                dev["blocked"] = True
                dev["activity"] = "⛔ Dropped (Firewall Block)"
                dev["dropped_packets"] += int((attempted_bytes - remaining_bytes) / 1024)
                self.blocked_set.add(mac)
                self.log_event(
                    f"🚨 QUOTA LIMIT REACHED ({dev['quota_gb']:.1f} GB): {dev['name']} hit quota limit! Remaining {format_bytes(attempted_bytes - remaining_bytes)} dropped & device BLOCKED by firewall.",
                    "BLOCK"
                )
                return True, f"Device reached quota limit ({dev['quota_gb']} GB) and was blocked!"
            else:
                dev["download_bytes"] += dl_bytes
                dev["upload_bytes"] += ul_bytes
                self._evaluate_quota(dev)
                return True, "Traffic added"

    def block_device(self, mac: str, reason: str = "Manual Block"):
        mac = mac.upper()
        with self.lock:
            dev = self.devices.get(mac)
            if not dev:
                return False, f"Device {mac} not found"
            dev["blocked"] = True
            dev["enabled"] = False
            dev["download_speed"] = 0.0
            dev["upload_speed"] = 0.0
            dev["activity"] = "⛔ Blocked (Manual)"
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
            dev["activity"] = "🌐 Web Browsing"
            self.blocked_set.discard(mac)
        self.log_event(f"Device {dev['name']} ({mac}) UNBLOCKED & enabled in nftables", "UNBLOCK")
        return True, "Device unblocked"

    def reset_quotas(self):
        with self.lock:
            for dev in self.devices.values():
                dev["download_bytes"] = 0.0
                dev["upload_bytes"] = 0.0
                dev["dropped_packets"] = 0
                dev["warning_80"] = False
                dev["warning_90"] = False
                dev["warning_95"] = False
                if dev["enabled"]:
                    dev["blocked"] = False
                    dev["activity"] = "🌐 Web Browsing"
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

        # Quota Exceeded -> Immediate Firewall Block & Traffic Cap
        if pct >= 100.0 and not dev["blocked"]:
            dev["blocked"] = True
            dev["download_speed"] = 0.0
            dev["upload_speed"] = 0.0
            dev["activity"] = "⛔ Dropped (Quota Exhausted)"
            self.blocked_set.add(mac)
            self.log_event(
                f"🚨 QUOTA EXHAUSTED: {dev['name']} reached 100% ({dev['quota_gb']:.1f} GB) -> BLOCKED by nftables firewall!",
                "BLOCK"
            )

    def traffic_simulation_tick(self):
        """Simulate real-world Wi-Fi background traffic growth capped strictly at quota."""
        with self.lock:
            if not self.traffic_active:
                return

            for dev in self.devices.values():
                if dev["blocked"]:
                    dev["download_speed"] = 0.0
                    dev["upload_speed"] = 0.0
                    dev["dropped_packets"] += random.randint(10, 40)
                    dev["activity"] = "⛔ Dropped (Firewall Block)"
                    continue

                quota_bytes = dev["quota_gb"] * (1024 ** 3)
                current_total = dev["download_bytes"] + dev["upload_bytes"]
                remaining_bytes = max(0.0, quota_bytes - current_total)

                if remaining_bytes <= 0:
                    dev["download_speed"] = 0.0
                    dev["upload_speed"] = 0.0
                    dev["blocked"] = True
                    dev["activity"] = "⛔ Dropped (Quota Exhausted)"
                    self.blocked_set.add(dev["mac"])
                    continue

                # Generate speed & activity
                base_speed = random.uniform(150_000, 1_600_000) * self.speed_multiplier
                dl_speed = base_speed * random.uniform(0.7, 1.3)
                ul_speed = base_speed * random.uniform(0.05, 0.2)
                tick_bytes = dl_speed + ul_speed

                # Track peak speed
                tot_speed = dl_speed + ul_speed
                if tot_speed > dev["peak_speed"]:
                    dev["peak_speed"] = tot_speed

                # Infer realistic activity based on speed
                if tot_speed > 1_500_000:
                    dev["activity"] = "🎥 4K Video (Netflix/YouTube)"
                    dev["connections"] = random.randint(30, 80)
                elif tot_speed > 800_000:
                    dev["activity"] = "📥 HD Stream / Downloads"
                    dev["connections"] = random.randint(20, 50)
                elif tot_speed > 300_000:
                    dev["activity"] = "🌐 Web Browsing / Social"
                    dev["connections"] = random.randint(15, 35)
                elif tot_speed > 80_000:
                    dev["activity"] = "🎮 Online Gaming / Discord"
                    dev["connections"] = random.randint(8, 20)
                else:
                    dev["activity"] = "💤 Idle / Background Sync"
                    dev["connections"] = random.randint(3, 10)

                if tick_bytes >= remaining_bytes:
                    # User hits the exact limit this second
                    dev["download_bytes"] += remaining_bytes
                    dev["download_speed"] = 0.0
                    dev["upload_speed"] = 0.0
                    dev["blocked"] = True
                    dev["activity"] = "⛔ Dropped (Quota Exhausted)"
                    self.blocked_set.add(dev["mac"])
                    self.log_event(
                        f"🚨 QUOTA LIMIT REACHED ({dev['quota_gb']:.1f} GB): {dev['name']} reached quota limit -> BLOCKED by firewall!",
                        "BLOCK"
                    )
                else:
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
                pct = min(100.0, (tot_gb / quota_gb * 100.0)) if quota_gb > 0 else 0.0
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
                    "peak_speed_bps": round(d["peak_speed"], 1),
                    "formatted_peak_speed": format_speed(d["peak_speed"]),
                    "activity": d["activity"],
                    "connections": d["connections"],
                    "dropped_packets": d["dropped_packets"],
                    "enabled": d["enabled"],
                    "is_blocked": d["blocked"],
                    "status": status,
                    "formatted_usage": format_bytes(tot_bytes),
                    "formatted_speed": format_speed(d["download_speed"] + d["upload_speed"]),
                })
            return res

    def get_isp_summary(self) -> Dict[str, Any]:
        """Aggregate total network usage against ISP monthly package pool."""
        with self.lock:
            devs = self.get_devices_summary()
            total_used_bytes = sum(d["download_gb"] + d["upload_gb"] for d in devs) * (1024 ** 3)
            total_used_gb = total_used_bytes / (1024 ** 3)
            allocated_gb = sum(d["quota_gb"] for d in devs)
            unallocated_gb = max(0.0, self.isp_total_package_gb - allocated_gb)
            pct = min(100.0, (total_used_gb / self.isp_total_package_gb * 100.0)) if self.isp_total_package_gb > 0 else 0.0
            total_speed = sum(d["download_speed_bps"] + d["upload_speed_bps"] for d in devs)

            return {
                "total_package_gb": self.isp_total_package_gb,
                "total_used_gb": round(total_used_gb, 2),
                "remaining_package_gb": round(max(0.0, self.isp_total_package_gb - total_used_gb), 2),
                "allocated_gb": round(allocated_gb, 2),
                "unallocated_gb": round(unallocated_gb, 2),
                "usage_percentage": round(pct, 1),
                "total_network_speed": format_speed(total_speed),
                "active_devices_count": len([d for d in devs if not d["is_blocked"]]),
                "blocked_devices_count": len([d for d in devs if d["is_blocked"]]),
            }


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

        # 2. ISP Package Summary
        if path in ["/package", "/api/package"]:
            self._send_json(200, self.simulator.get_isp_summary())
            return

        # 3. Devices Endpoints
        if path in ["/devices", "/api/devices"]:
            devices = self.simulator.get_devices_summary()
            self._send_json(200, {
                "status": "success",
                "count": len(devices),
                "devices": devices
            })
            return

        # 4. Quotas Endpoints
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

        # 5. Firewall Blocks Endpoints
        if path in ["/blocks", "/api/blocks", "/api/firewall/blocked"]:
            with self.simulator.lock:
                blocked = list(self.simulator.blocked_set)
            self._send_json(200, {
                "status": "success",
                "count": len(blocked),
                "blocked": blocked
            })
            return

        # 6. Interactive HTML Web Dashboard
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

        # Distribute Quotas (Equal or Custom)
        if path in ["/api/package/distribute", "/distribute"]:
            mode = payload.get("mode", "equal")
            if mode == "equal":
                ok, msg = self.simulator.distribute_equal()
            else:
                allocations = payload.get("allocations", {})
                ok, msg = self.simulator.distribute_quotas(allocations)
            self._send_json(200 if ok else 400, {"status": "success" if ok else "error", "message": msg})
            return

        # Set Single Device Quota
        match_quota = re.match(r"^/(?:api/)?devices/([0-9a-fA-F:]{17})/quota$", path)
        if match_quota or path in ["/api/quotas", "/quota"]:
            mac = match_quota.group(1) if match_quota else payload.get("mac", "")
            quota_gb = float(payload.get("quota_gb", 20.0))
            ok, msg = self.simulator.set_quota(mac, quota_gb)
            self._send_json(200 if ok else 400, {"status": "success" if ok else "error", "message": msg})
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
    .container { max-width: 1050px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 16px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 24px; color: #38bdf8; }
    .badge { padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: bold; background: #22c55e; color: #000; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .stat-card { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px; }
    .stat-title { font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; }
    .stat-value { font-size: 20px; font-weight: bold; color: #38bdf8; }
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
    .btn-outline { background: transparent; border: 1px solid #38bdf8; color: #38bdf8; }
    .btn-outline:hover { background: #38bdf8; color: #000; }
    .activity-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; background: #334155; color: #e2e8f0; }
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
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Quota Distribution & Real-time Network Activity Monitor</p>
      </div>
      <div>
        <span class="badge">🟢 ROUTER ONLINE</span>
      </div>
    </header>

    <!-- ISP Package Pool Card -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h2 style="margin: 0; font-size: 16px;">📦 ISP Monthly Internet Package Pool</h2>
        <div>
          <button class="btn btn-outline" onclick="distributeEqual()">⚖️ Distribute Equal Quotas</button>
          <button class="btn btn-success" onclick="resetQuotas()">🔄 Reset All Quotas</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-title">Total ISP Pool</div>
          <div class="stat-value" id="isp-total">250.0 GB</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Network Used</div>
          <div class="stat-value" id="isp-used">0.0 GB</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Allocated to Devices</div>
          <div class="stat-value" id="isp-allocated">0.0 GB</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Total Network Speed</div>
          <div class="stat-value" id="isp-speed">0 B/s</div>
        </div>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8;">
          <span>Package Consumption: <strong id="isp-pct-text">0%</strong></span>
          <span id="isp-rem-text">Remaining: 250 GB</span>
        </div>
        <div class="progress-bar-bg" style="height: 12px;">
          <div id="isp-bar" class="progress-bar-fill" style="width: 0%; background: #38bdf8;"></div>
        </div>
      </div>
    </div>

    <!-- Connected Devices & Quotas -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 18px;">Active Connected Wi-Fi Devices & Quota Tracking</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>IP / MAC</th>
            <th>Live Activity</th>
            <th>Speed</th>
            <th>Quota Progress</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="devices-table">
          <tr><td colspan="7" style="text-align: center; color: #94a3b8;">Loading devices...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Live Event Stream -->
    <div class="card">
      <h2 style="margin: 0 0 12px 0; font-size: 16px;">Live System, Traffic & Firewall Events</h2>
      <div id="logs" class="log-box">Connecting to event stream...</div>
    </div>
  </div>

  <script>
    async function fetchAll() {
      try {
        // 1. Fetch ISP Package summary
        const pkgRes = await fetch('/api/package');
        const pkg = await pkgRes.json();
        document.getElementById('isp-total').innerText = pkg.total_package_gb + ' GB';
        document.getElementById('isp-used').innerText = pkg.total_used_gb + ' GB';
        document.getElementById('isp-allocated').innerText = pkg.allocated_gb + ' GB';
        document.getElementById('isp-speed').innerText = pkg.total_network_speed;
        document.getElementById('isp-pct-text').innerText = pkg.usage_percentage + '%';
        document.getElementById('isp-rem-text').innerText = 'Remaining: ' + pkg.remaining_package_gb + ' GB';
        document.getElementById('isp-bar').style.width = Math.min(100, pkg.usage_percentage) + '%';

        // 2. Fetch Devices
        const devRes = await fetch('/api/devices');
        const data = await devRes.json();
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
            <td><span class="activity-badge">${d.activity}</span></td>
            <td><span style="color: #38bdf8; font-weight: 500;">${d.formatted_speed}</span></td>
            <td style="min-width: 170px;">
              <div style="display: flex; justify-content: space-between; font-size: 12px;">
                <span>${d.usage_gb.toFixed(1)} / ${d.quota_gb.toFixed(1)} GB</span>
                <span><strong>${d.usage_percentage}%</strong></span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${Math.min(100, d.usage_percentage)}%; background: ${barColor};"></div>
              </div>
            </td>
            <td><span class="${statusClass}">${statusText}</span></td>
            <td>
              <button class="btn btn-outline" onclick="editQuota('${d.mac}', ${d.quota_gb})">Set Quota</button>
              ${d.is_blocked ? 
                `<button class="btn btn-success" onclick="unblock('${d.mac}')">Unblock</button>` : 
                `<button class="btn btn-danger" onclick="block('${d.mac}')">Block</button>`
              }
              <button class="btn" onclick="burst('${d.mac}', 5000)">+5GB</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      } catch (e) {
        console.error(e);
      }
    }

    async function editQuota(mac, currentQuota) {
      const newQuota = prompt('Enter new quota in GB for this device:', currentQuota);
      if (newQuota !== null && !isNaN(newQuota) && Number(newQuota) > 0) {
        await fetch('/api/devices/' + mac + '/quota', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quota_gb: parseFloat(newQuota) })
        });
        fetchAll();
      }
    }

    async function distributeEqual() {
      if (confirm('Distribute ISP package quota equally among active devices?')) {
        await fetch('/api/package/distribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'equal' })
        });
        fetchAll();
      }
    }

    async function block(mac) {
      await fetch('/api/devices/' + mac + '/block', { method: 'POST', body: JSON.stringify({ reason: 'Web Dashboard' }) });
      fetchAll();
    }

    async function unblock(mac) {
      await fetch('/api/devices/' + mac + '/unblock', { method: 'POST' });
      fetchAll();
    }

    async function burst(mac, mb) {
      await fetch('/api/simulate/burst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac: mac, download_mb: mb }) });
      fetchAll();
    }

    async function resetQuotas() {
      await fetch('/api/quotas/reset', { method: 'POST' });
      fetchAll();
    }

    setInterval(fetchAll, 1500);
    fetchAll();
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
    isp = sim.get_isp_summary()
    os.system("clear" if os.name == "posix" else "cls")

    print(f"{Colors.BOLD}{Colors.CYAN}===================================================================================================={Colors.RESET}")
    print(f"{Colors.BOLD}🚀 OPENWRT WI-FI QUOTA MANAGER — NETWORK MONITOR & QUOTA SIMULATOR{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}===================================================================================================={Colors.RESET}")
    print(f"📡 {Colors.BOLD}Simulator Server:{Colors.RESET} {Colors.GREEN}http://127.0.0.1:{port}{Colors.RESET} | Web UI: {Colors.CYAN}http://127.0.0.1:{port}/dashboard{Colors.RESET}")

    # ISP Package Progress Bar
    isp_pct = isp["usage_percentage"]
    isp_filled = int(min(1.0, isp_pct / 100.0) * 12)
    isp_empty = 12 - isp_filled
    isp_bar = f"[{'█' * isp_filled}{'░' * isp_empty}] {isp_pct:>4.1f}%"
    print(f"📦 {Colors.BOLD}ISP Package Pool:{Colors.RESET} {isp['total_used_gb']:.1f} / {isp['total_package_gb']:.1f} GB {isp_bar} | Allocated: {isp['allocated_gb']:.1f} GB | Free: {isp['unallocated_gb']:.1f} GB")
    print(f"🌐 {Colors.BOLD}Live Network Speed:{Colors.RESET} {isp['total_network_speed']} | Active: {isp['active_devices_count']} | Blocked: {isp['blocked_devices_count']}")
    print("-" * 100)

    # Devices Table Header
    print(f"{Colors.BOLD}{'Device Name':<15} {'MAC Address':<18} {'Live Activity':<24} {'Speed':<11} {'Usage / Quota':<17} {'Progress':<11} {'Status'}{Colors.RESET}")
    print("-" * 100)

    for d in devices:
        name = d["name"][:14]
        mac = d["mac"]
        act = d["activity"][:23]
        speed = d["formatted_speed"]
        usage_str = f"{d['usage_gb']:>4.1f} / {d['quota_gb']:>4.1f} GB"
        pct = d["usage_percentage"]

        # Progress bar
        bar_len = 6
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
        print(f"{name:<15} {mac:<18} {act:<24} {speed:<11} {usage_str:<17} {bar:<17} {status_text}")

    print("-" * 100)
    print(f"{Colors.BOLD}📋 Live Events & Firewall Dropped Packets:{Colors.RESET}")
    with sim.lock:
        recent_logs = sim.event_logs[-4:]
    if recent_logs:
        for log in recent_logs:
            print(f"  {log}")
    else:
        print("  (Awaiting network activity...)")

    print("-" * 100)
    print(f"{Colors.GRAY}Commands: [distribute] Alloc Quotas | [quota <mac> <GB>] Set Quota | [burst <mac> <MB>] Traffic | [inspect <mac>] Stats | [reset] Reset | [q] Exit{Colors.RESET}")


def run_traffic_worker(sim: OpenWrtRouterSimulator):
    while sim.traffic_active:
        sim.traffic_simulation_tick()
        time.sleep(1.0)


def launch_flutter_client(device: str = "linux"):
    print(f"\n{Colors.CYAN}🚀 Launching Flutter Client ({device})...{Colors.RESET}")
    cmd = ["flutter", "run", "-d", device]
    try:
        subprocess.Popen(cmd, cwd=str(FLUTTER_DIR))
    except Exception as e:
        print(f"{Colors.RED}❌ Failed to start flutter: {e}{Colors.RESET}")


def interactive_distribute_wizard(sim: OpenWrtRouterSimulator):
    """Interactive wizard to distribute ISP package quota."""
    os.system("clear" if os.name == "posix" else "cls")
    print(f"{Colors.BOLD}{Colors.CYAN}================================================================================{Colors.RESET}")
    print(f"{Colors.BOLD}⚖️  QUOTA DISTRIBUTION WIZARD — ISP PACKAGE ALLOCATOR{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}================================================================================{Colors.RESET}")
    isp = sim.get_isp_summary()
    print(f"Total ISP Monthly Package: {Colors.GREEN}{isp['total_package_gb']:.1f} GB{Colors.RESET}")
    print("\nChoose distribution mode:")
    print("  [1] Equal Distribution (Divide package equally among active devices)")
    print("  [2] Custom Allocation per Device")
    print("  [3] Change ISP Package Total (Current: {:.1f} GB)".format(isp["total_package_gb"]))
    print("  [0] Cancel")

    choice = input("\nEnter choice [1-3] > ").strip()

    if choice == "1":
        sim.distribute_equal()
        print(f"{Colors.GREEN}✅ Equal quota distributed!{Colors.RESET}")
        time.sleep(1.5)

    elif choice == "2":
        allocations = {}
        with sim.lock:
            devices = list(sim.devices.values())
        print(f"\nDistribute among devices (Total Pool: {isp['total_package_gb']:.1f} GB):")
        for d in devices:
            val = input(f"  • Quota for {d['name']} ({d['mac']}) [Current: {d['quota_gb']} GB] > ").strip()
            if val:
                try:
                    allocations[d["mac"]] = float(val)
                except ValueError:
                    allocations[d["mac"]] = d["quota_gb"]
            else:
                allocations[d["mac"]] = d["quota_gb"]

        ok, msg = sim.distribute_quotas(allocations)
        if ok:
            print(f"{Colors.GREEN}✅ {msg}{Colors.RESET}")
        else:
            print(f"{Colors.RED}❌ {msg}{Colors.RESET}")
        time.sleep(2)

    elif choice == "3":
        val = input("Enter new ISP package total in GB > ").strip()
        try:
            sim.set_isp_package(float(val))
            print(f"{Colors.GREEN}✅ ISP Package updated to {val} GB{Colors.RESET}")
        except ValueError:
            print("Invalid number")
        time.sleep(1.5)


def inspect_device(sim: OpenWrtRouterSimulator, target: str):
    """Detailed inspection of a device's network statistics."""
    found = None
    with sim.lock:
        for m, d in sim.devices.items():
            if m.startswith(target.upper()) or target.lower() in d["name"].lower():
                found = dict(d)
                break

    if not found:
        print(f"{Colors.RED}Device '{target}' not found{Colors.RESET}")
        time.sleep(1.5)
        return

    os.system("clear" if os.name == "posix" else "cls")
    print(f"{Colors.BOLD}{Colors.CYAN}================================================================================{Colors.RESET}")
    print(f"{Colors.BOLD}🔍 NETWORK INSPECTION: {found['name']} ({found['mac']}){Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}================================================================================{Colors.RESET}")
    tot_bytes = found["download_bytes"] + found["upload_bytes"]
    print(f"• IP Address:            {found['ip']}")
    print(f"• Current Activity:      {found['activity']}")
    print(f"• Status:                {'🔴 BLOCKED (Firewall)' if found['blocked'] else '🟢 ALLOWED'}")
    print(f"• Current Speed:         ↓ {format_speed(found['download_speed'])} | ↑ {format_speed(found['upload_speed'])}")
    print(f"• Peak Recorded Speed:   {format_speed(found['peak_speed'])}")
    print(f"• Downloaded:            {format_bytes(found['download_bytes'])}")
    print(f"• Uploaded:              {format_bytes(found['upload_bytes'])}")
    print(f"• Total Consumed:        {format_bytes(tot_bytes)} / {found['quota_gb']:.1f} GB")
    print(f"• Dropped Packets:       {found['dropped_packets']} packets (firewall rejected)")
    print(f"• Active TCP/UDP Conns:  {found['connections']}")
    print("=" * 80)
    input("\nPress Enter to return to dashboard...")


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

            elif cmd in ["distribute", "dist", "alloc"]:
                interactive_distribute_wizard(sim)

            elif cmd in ["quota", "setquota"]:
                if len(parts) < 3:
                    print("Usage: quota <mac/name> <GB>")
                    time.sleep(1.5)
                    continue
                target = parts[1]
                gb = float(parts[2])
                found_mac = None
                with sim.lock:
                    for m, d in sim.devices.items():
                        if m.startswith(target.upper()) or target.lower() in d["name"].lower():
                            found_mac = m
                            break
                if found_mac:
                    sim.set_quota(found_mac, gb)
                else:
                    print(f"Device '{target}' not found")
                time.sleep(1.5)

            elif cmd in ["inspect", "info", "stat"]:
                if len(parts) < 2:
                    print("Usage: inspect <mac/name>")
                    time.sleep(1.5)
                    continue
                inspect_device(sim, parts[1])

            elif cmd in ["package", "pool"]:
                if len(parts) < 2:
                    print("Usage: package <GB>")
                    time.sleep(1.5)
                    continue
                sim.set_isp_package(float(parts[1]))
                time.sleep(1.5)

            elif cmd in ["r", "reset"]:
                sim.reset_quotas()
                time.sleep(1)

            elif cmd in ["b", "block"]:
                if len(parts) < 2:
                    print("Usage: b <mac or name>")
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
                print("  distribute               : Open Quota Distribution Wizard (divide ISP package)")
                print("  quota <mac/name> <GB>    : Set quota for specific device")
                print("  package <GB>             : Set total monthly ISP package limit")
                print("  inspect <mac/name>       : Deep network inspection for a device")
                print("  b <mac/name>             : Immediately block device at firewall")
                print("  u <mac/name>             : Unblock device")
                print("  burst <mac/name> <MB>    : Add traffic burst (stops strictly at quota)")
                print("  reset                    : Reset billing cycle & clear blocks")
                print("  client [linux|chrome]    : Launch Flutter Client application")
                print("  q / exit                 : Exit simulator")
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
        description="OpenWrt Wi-Fi Quota Manager — Interactive Simulator & Network Monitor"
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

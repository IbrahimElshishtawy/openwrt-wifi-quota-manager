#!/usr/bin/env python3
"""
OpenWrt Wi-Fi Quota Manager - System Runner (run_system.py)
----------------------------------------------------------
A unified Python script to manage, start, and monitor all components
of the OpenWrt Wi-Fi Quota Manager system:
  1. OpenWrt Python REST API (Port 8080)
  2. Node.js / Docker Controller (Port 3050)
  3. System Health & Connectivity Verifier
"""

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
OPENWRT_API_SCRIPT = ROOT_DIR / "openwrt" / "api" / "api_usage.py"
DOCKER_COMPOSE_FILE = ROOT_DIR / "openwrt-controller" / "deploy" / "docker" / "docker-compose.yml"
CONTROLLER_DIR = ROOT_DIR / "openwrt-controller"

CONTROLLER_URL = "http://127.0.0.1:3050"
API_URL = "http://127.0.0.1:8080"
ROUTER_IP = "192.168.50.1"


def print_banner(title: str):
    print("\n" + "=" * 72)
    print(f"🚀 {title}")
    print("=" * 72)


def check_url(url: str, timeout: float = 2.0) -> tuple[bool, dict | str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "QuotaManager-CLI"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                data = response.read().decode("utf-8")
                try:
                    return True, json.loads(data)
                except Exception:
                    return True, data
    except Exception as e:
        return False, str(e)
    return False, "Unknown status"


def is_port_in_use(port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def check_status():
    print_banner("System Health & Status Check")

    # 1. Controller Status (Port 3050)
    controller_ok, controller_data = check_url(f"{CONTROLLER_URL}/health/live")
    if controller_ok:
        print(f"• Node/Docker Controller ({CONTROLLER_URL}): 🟢 ONLINE")
        if isinstance(controller_data, dict):
            uptime = controller_data.get("uptimeSeconds", 0)
            print(f"  └─ Uptime: {uptime}s | PID: {controller_data.get('pid', 'N/A')}")
    else:
        print(f"• Node/Docker Controller ({CONTROLLER_URL}): 🔴 OFFLINE")

    # 2. OpenWrt Python API Status (Port 8080)
    api_ok, api_data = check_url(f"{API_URL}/health")
    if api_ok:
        print(f"• OpenWrt Python API ({API_URL}): 🟢 ONLINE")
        if isinstance(api_data, dict):
            print(f"  └─ Service: {api_data.get('service', 'API')} | v{api_data.get('version', '1.0')}")
    else:
        print(f"• OpenWrt Python API ({API_URL}): 🔴 OFFLINE")

    # 3. OpenWrt Hardware Router Reachability
    ping_res = subprocess.run(["ping", "-c", "1", "-W", "1", ROUTER_IP],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if ping_res.returncode == 0:
        print(f"• OpenWrt Router Hardware ({ROUTER_IP}): 🟢 REACHABLE")
    else:
        print(f"• OpenWrt Router Hardware ({ROUTER_IP}): 🟡 UNREACHABLE (Normal if offline or in simulated dev)")

    # 4. Connected Devices count if controller is up
    if controller_ok:
        dev_ok, dev_data = check_url(f"{CONTROLLER_URL}/api/devices")
        if dev_ok and isinstance(dev_data, dict):
            print(f"• Managed Devices: {dev_data.get('count', len(dev_data.get('devices', [])))}")

    print("=" * 72)


def start_controller():
    print("\n📦 Checking OpenWrt Controller (Port 3050)...")
    if is_port_in_use(3050):
        print("✅ OpenWrt Controller is already running on port 3050.")
        return None

    # Try Docker Compose first
    if DOCKER_COMPOSE_FILE.exists():
        print("🐳 Starting OpenWrt Controller via Docker Compose...")
        cmd = ["docker", "compose", "-f", str(DOCKER_COMPOSE_FILE), "up", "-d"]
        res = subprocess.run(cmd, cwd=str(DOCKER_COMPOSE_FILE.parent))
        if res.returncode == 0:
            print("⏳ Waiting for Controller to respond...")
            for _ in range(15):
                time.sleep(1)
                ok, _ = check_url(f"{CONTROLLER_URL}/health/live")
                if ok:
                    print("✅ OpenWrt Controller is Online on http://127.0.0.1:3050")
                    return None
            print("⚠️ Controller container started, still warming up.")
            return None

    # Fallback to local node if dist exists
    dist_server = CONTROLLER_DIR / "dist" / "server.js"
    if dist_server.exists():
        print("🚀 Starting Controller locally using Node.js...")
        proc = subprocess.Popen(["node", str(dist_server)], cwd=str(CONTROLLER_DIR))
        return proc

    print("❌ Could not start controller. Please ensure Docker is running or run `npm run build && npm run start` in openwrt-controller.")
    return None


def run_openwrt_api(port: int = 8080, dry_run: bool = True):
    print(f"\n🐍 Starting OpenWrt Python API Server on port {port}...")
    if is_port_in_use(port):
        print(f"⚠️ Port {port} is already in use. Python API might already be running.")
        return None

    cmd = [sys.executable, str(OPENWRT_API_SCRIPT), "--port", str(port)]
    if dry_run:
        cmd.append("--dry-run")

    print(f"Executing: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd)
    
    # Wait briefly to confirm start
    for _ in range(10):
        time.sleep(0.5)
        ok, _ = check_url(f"http://127.0.0.1:{port}/health")
        if ok:
            print(f"✅ OpenWrt Python API is Online & Healthy on http://127.0.0.1:{port}")
            break
            
    return proc


def run_all(api_port: int = 8080, dry_run: bool = True):
    print_banner("Starting OpenWrt Wi-Fi Quota Manager System")

    # 1. Controller
    start_controller()

    # 2. OpenWrt Python API
    api_proc = run_openwrt_api(port=api_port, dry_run=dry_run)

    # 3. Print status overview
    time.sleep(1)
    check_status()

    print("\n📱 Access Endpoints:")
    print(f"   • OpenWrt Controller API: {CONTROLLER_URL}")
    print(f"   • OpenWrt Python REST API: http://127.0.0.1:{api_port}")
    print(f"   • Devices list: http://127.0.0.1:{api_port}/devices")
    print("\n💡 Press Ctrl+C at any time to stop the Python API server.")

    if api_proc:
        try:
            api_proc.wait()
        except KeyboardInterrupt:
            print("\n🛑 Stopping OpenWrt Python API...")
            api_proc.send_signal(signal.SIGINT)
            api_proc.wait(timeout=3)
            print("✅ Stopped gracefully.")


def main():
    parser = argparse.ArgumentParser(
        description="OpenWrt Wi-Fi Quota Manager - System Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 run_system.py               # Start all components (Controller + Python API)
  python3 run_system.py --status      # Check health of all services
  python3 run_system.py --api         # Run only OpenWrt Python API (port 8080)
  python3 run_system.py --controller  # Run only OpenWrt Controller (port 3050)
  python3 run_system.py --simulate    # Run offline workflow simulator
        """
    )
    parser.add_argument("--status", action="store_true", help="Check status and health of all components")
    parser.add_argument("--simulator", "--sim", action="store_true", help="Launch interactive OpenWrt router simulator with live traffic & firewall blocking")
    parser.add_argument("--client", action="store_true", help="Launch Flutter client along with the system")
    parser.add_argument("--api", action="store_true", help="Start only the OpenWrt Python REST API (port 8080)")
    parser.add_argument("--controller", action="store_true", help="Start only the OpenWrt Controller (port 3050)")
    parser.add_argument("--simulate", action="store_true", help="Run the offline Python workflow simulator")
    parser.add_argument("--port", type=int, default=8080, help="Port for OpenWrt Python API (default: 8080)")
    parser.add_argument("--no-dry-run", action="store_true", help="Disable dry-run mode (requires real OpenWrt/nftables)")

    args = parser.parse_args()

    if args.status:
        check_status()
        return

    if args.simulator:
        sim_script = ROOT_DIR / "openwrt_simulator.py"
        cmd = [sys.executable, str(sim_script), "--port", str(args.port)]
        if args.client:
            cmd.append("--client")
        subprocess.run(cmd)
        return

    if args.simulate:
        sim_path = ROOT_DIR / "openwrt" / "scripts" / "simulate.py"
        print(f"Running simulation: {sim_path}")
        subprocess.run([sys.executable, str(sim_path)])
        return

    if args.controller:
        start_controller()
        check_status()
        return

    if args.api:
        proc = run_openwrt_api(port=args.port, dry_run=not args.no_dry_run)
        if proc:
            try:
                proc.wait()
            except KeyboardInterrupt:
                proc.send_signal(signal.SIGINT)
        return

    # Default action: start everything!
    run_all(api_port=args.port, dry_run=not args.no_dry_run)


if __name__ == "__main__":
    main()

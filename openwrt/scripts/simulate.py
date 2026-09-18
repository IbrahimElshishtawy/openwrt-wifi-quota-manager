#!/usr/bin/env python3
"""
OpenWrt Wi-Fi Quota Manager - Offline Workflow Simulator
Simulates router behavior, traffic growth, nlbwmon metrics, and quota enforcement
without needing physical OpenWrt hardware.
"""

import sys
import time
from pathlib import Path

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from device_manager import DeviceManager
from usage_manager import UsageManager
from check_quota import QuotaChecker


def run_simulation():
    print("\n" + "=" * 76)
    print("      STARTING OPENWRT WI-FI QUOTA MANAGER SIMULATION (DEMO)        ")
    print("=" * 76)

    # 1. Setup mock devices
    config_path = SCRIPTS_DIR.parent / "config" / "devices.json"
    dev_mgr = DeviceManager(config_path=str(config_path))
    devices = dev_mgr.get_devices()

    print(f"\n[STEP 1] Loaded {len(devices)} configured devices from devices.json:")
    for d in devices:
        status_str = "ENABLED" if d["enabled"] else "DISABLED"
        print(f"  * {d['mac']} | {d['name']:<18} | Quota: {d['quota_gb']} GB | Status: {status_str}")

    # 2. Simulation timeline
    simulated_steps = [
        {
            "description": "Initial state: Moderate internet usage within quotas",
            "usage": {
                "AA:BB:CC:DD:EE:FF": {"mac": "AA:BB:CC:DD:EE:FF", "rx_bytes": 10 * (1024**3), "tx_bytes": 2 * (1024**3), "total_bytes": 12 * (1024**3), "total_gb": 12.0},
                "11:22:33:44:55:66": {"mac": "11:22:33:44:55:66", "rx_bytes": 20 * (1024**3), "tx_bytes": 5 * (1024**3), "total_bytes": 25 * (1024**3), "total_gb": 25.0},
                "66:77:88:99:AA:BB": {"mac": "66:77:88:99:AA:BB", "rx_bytes": 1 * (1024**3), "tx_bytes": 0, "total_bytes": 1 * (1024**3), "total_gb": 1.0},
            }
        },
        {
            "description": "High traffic spike: 'Ahmed Phone' exceeds its 20 GB quota allowance!",
            "usage": {
                "AA:BB:CC:DD:EE:FF": {"mac": "AA:BB:CC:DD:EE:FF", "rx_bytes": 18 * (1024**3), "tx_bytes": 4 * (1024**3), "total_bytes": 22 * (1024**3), "total_gb": 22.0},
                "11:22:33:44:55:66": {"mac": "11:22:33:44:55:66", "rx_bytes": 25 * (1024**3), "tx_bytes": 6 * (1024**3), "total_bytes": 31 * (1024**3), "total_gb": 31.0},
                "66:77:88:99:AA:BB": {"mac": "66:77:88:99:AA:BB", "rx_bytes": 1 * (1024**3), "tx_bytes": 0, "total_bytes": 1 * (1024**3), "total_gb": 1.0},
            }
        }
    ]

    for idx, step in enumerate(simulated_steps, 1):
        print("\n" + "-" * 76)
        print(f"[CYCLE {idx}] {step['description']}")
        print("-" * 76)

        usage_mgr = UsageManager(mock_data={"records": list(step["usage"].values())})
        checker = QuotaChecker(device_manager=dev_mgr, usage_manager=usage_mgr, dry_run=True)

        # Run quota check
        summary = checker.check_all_quotas()

        print(f"\n[CYCLE {idx} SUMMARY]: Evaluated: {summary['evaluated']} | Blocked: {summary['blocked']} | Allowed: {summary['allowed']}")
        for detail in summary["details"]:
            decision_tag = "[BLOCKED]" if detail["decision"] == "block" else "[ALLOWED]"
            print(f"  -> {detail['mac']} ({detail['name']}): {detail['usage_gb']} GB / {detail['quota_gb']} GB -> {decision_tag}")

    print("\n" + "=" * 76)
    print("                     SIMULATION COMPLETED                           ")
    print("=" * 76 + "\n")


if __name__ == "__main__":
    run_simulation()

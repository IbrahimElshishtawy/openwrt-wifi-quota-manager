#!/usr/bin/env python3
"""
OpenWrt Wi-Fi Quota Manager - Offline Workflow Simulator
Simulates the complete router lifecycle: device association, progressive traffic growth,
warning threshold notifications (80%, 90%, 95%), quota exhaustion enforcement via nftables,
and quota period reset without requiring a physical OpenWrt router.
"""

import sys
import tempfile
import time
from pathlib import Path

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from device_manager import DeviceManager
from usage_manager import UsageManager, bytes_to_gb, format_bytes
from check_quota import QuotaChecker, WarningStateManager


def run_simulation():
    print("\n" + "=" * 80)
    print("      STARTING OPENWRT WI-FI QUOTA MANAGER LIFECYCLE SIMULATOR (DEMO)       ")
    print("=" * 80)

    # 1. Setup mock environment with temporary warning state
    temp_dir = tempfile.TemporaryDirectory()
    state_file = Path(temp_dir.name) / "warning_state.json"
    warning_mgr = WarningStateManager(state_path=str(state_file))

    config_path = SCRIPTS_DIR.parent / "config" / "devices.json"
    dev_mgr = DeviceManager(config_path=str(config_path))
    devices = dev_mgr.get_devices()

    print(f"\n[PHASE 1: CONFIGURATION LOAD]")
    print(f"Loaded {len(devices)} configured devices from devices.json:")
    for d in devices:
        status_str = "ENABLED" if d["enabled"] else "DISABLED"
        print(f"  * {d['mac']} | {d['name']:<18} | Quota: {d['quota_gb']:>5.1f} GB | State: {status_str}")

    # 2. Simulation timeline with 4 progressive cycles
    simulated_steps = [
        {
            "cycle": 1,
            "title": "Normal Morning Activity (Under 50% Quota)",
            "description": "All devices active with routine web browsing and audio streaming.",
            "usage": {
                "AA:BB:CC:DD:EE:FF": {"mac": "AA:BB:CC:DD:EE:FF", "download_bytes": 5 * (1024**3), "upload_bytes": 1 * (1024**3), "total_bytes": 6 * (1024**3)},    # 6GB / 20GB = 30%
                "11:22:33:44:55:66": {"mac": "11:22:33:44:55:66", "download_bytes": 15 * (1024**3), "upload_bytes": 2 * (1024**3), "total_bytes": 17 * (1024**3)}, # 17GB / 50GB = 34%
                "66:77:88:99:AA:BB": {"mac": "66:77:88:99:AA:BB", "download_bytes": 1 * (1024**3), "upload_bytes": 0, "total_bytes": 1 * (1024**3)},              # Disabled
            }
        },
        {
            "cycle": 2,
            "title": "Heavy Video Streaming (Warning Threshold Reached)",
            "description": "Ahmed Phone streams 4K video, crossing the 80% and 90% warning thresholds.",
            "usage": {
                "AA:BB:CC:DD:EE:FF": {"mac": "AA:BB:CC:DD:EE:FF", "download_bytes": 16 * (1024**3), "upload_bytes": 2 * (1024**3), "total_bytes": 18 * (1024**3)}, # 18GB / 20GB = 90%
                "11:22:33:44:55:66": {"mac": "11:22:33:44:55:66", "download_bytes": 22 * (1024**3), "upload_bytes": 3 * (1024**3), "total_bytes": 25 * (1024**3)}, # 25GB / 50GB = 50%
                "66:77:88:99:AA:BB": {"mac": "66:77:88:99:AA:BB", "download_bytes": 1 * (1024**3), "upload_bytes": 0, "total_bytes": 1 * (1024**3)},
            }
        },
        {
            "cycle": 3,
            "title": "Quota Exceeded (Firewall Enforcement)",
            "description": "Ahmed Phone downloads a large file and exceeds its 20GB limit. Blocked in nftables!",
            "usage": {
                "AA:BB:CC:DD:EE:FF": {"mac": "AA:BB:CC:DD:EE:FF", "download_bytes": 19 * (1024**3), "upload_bytes": 2 * (1024**3), "total_bytes": 21 * (1024**3)}, # 21GB / 20GB = 105% -> BLOCK
                "11:22:33:44:55:66": {"mac": "11:22:33:44:55:66", "download_bytes": 28 * (1024**3), "upload_bytes": 4 * (1024**3), "total_bytes": 32 * (1024**3)}, # 32GB / 50GB = 64%
                "66:77:88:99:AA:BB": {"mac": "66:77:88:99:AA:BB", "download_bytes": 1 * (1024**3), "upload_bytes": 0, "total_bytes": 1 * (1024**3)},
            }
        },
        {
            "cycle": 4,
            "title": "New Billing Cycle (Automatic Quota Reset)",
            "description": "Monthly renewal triggers: warning states clear and Ahmed Phone is unblocked.",
            "reset_first": True,
            "usage": {
                "AA:BB:CC:DD:EE:FF": {"mac": "AA:BB:CC:DD:EE:FF", "download_bytes": 0, "upload_bytes": 0, "total_bytes": 0},
                "11:22:33:44:55:66": {"mac": "11:22:33:44:55:66", "download_bytes": 0, "upload_bytes": 0, "total_bytes": 0},
                "66:77:88:99:AA:BB": {"mac": "66:77:88:99:AA:BB", "download_bytes": 0, "upload_bytes": 0, "total_bytes": 0},
            }
        }
    ]

    for step in simulated_steps:
        print("\n" + "-" * 80)
        print(f"[CYCLE {step['cycle']}]: {step['title']}")
        print(f"Scenario: {step['description']}")
        print("-" * 80)

        usage_mgr = UsageManager(mock_data={"records": list(step["usage"].values())})
        checker = QuotaChecker(
            device_manager=dev_mgr,
            usage_manager=usage_mgr,
            warning_manager=warning_mgr,
            dry_run=True
        )

        if step.get("reset_first"):
            print(">> Simulating billing cycle reset...")
            checker.reset_quota_period()

        summary = checker.check_all_quotas()

        print(f"\nAudit Summary: Evaluated {summary['evaluated']} | Blocked {summary['blocked']} | Allowed {summary['allowed']}")
        for detail in summary["details"]:
            state_tag = f"[{detail['status'].upper()}]"
            quota_str = f"{detail['usage_gb']:.1f} / {detail['quota_gb']:.1f} GB ({detail['usage_percentage']:.0f}%)"
            print(f"  * {detail['mac']} ({detail['name']:<16}): {quota_str:<22} -> Action: {detail['decision'].upper():<7} {state_tag}")

    temp_dir.cleanup()
    print("\n" + "=" * 80)
    print("                     SIMULATION COMPLETED SUCCESSFULLY                      ")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    run_simulation()

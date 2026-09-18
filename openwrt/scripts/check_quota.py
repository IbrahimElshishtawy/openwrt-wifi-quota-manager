#!/usr/bin/env python3
"""
Check Quota Engine
The core policy orchestration module for OpenWrt Wi-Fi Quota Manager.
Compares active bandwidth consumption against configured device allowances
and executes access control via nftables.
"""

import argparse
import logging
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional

# Ensure sibling modules can be imported directly
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

try:
    from openwrt.scripts.device_manager import DeviceManager, normalize_mac
    from openwrt.scripts.usage_manager import UsageManager
except (ImportError, ModuleNotFoundError):
    from device_manager import DeviceManager, normalize_mac  # type: ignore
    from usage_manager import UsageManager                    # type: ignore

# Configure root logger with requested bracketed format
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(message)s"
)
logger = logging.getLogger("QuotaManager.Core")

TABLE_NAME = "inet quota_manager"
SET_NAME = "blocked_devices"


class QuotaChecker:
    """
    Coordinates between DeviceManager, UsageManager, and nftables.
    """

    def __init__(
        self,
        device_manager: DeviceManager,
        usage_manager: UsageManager,
        dry_run: bool = False
    ):
        """
        :param device_manager: Instance of DeviceManager
        :param usage_manager: Instance of UsageManager
        :param dry_run: If True, firewall modification commands are logged but not executed.
        """
        self.device_manager = device_manager
        self.usage_manager = usage_manager
        self.dry_run = dry_run

    def is_device_blocked(self, mac: str) -> bool:
        """
        Checks if the MAC address is currently present in the nftables blocked_devices set.
        """
        norm_mac = normalize_mac(mac)
        if self.dry_run:
            logger.debug("[DRY-RUN] Checking if %s is in %s", norm_mac, SET_NAME)
            return False

        cmd = ["nft", "get", "element", "inet", "quota_manager", SET_NAME, f"{{ {norm_mac} }}"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
            return proc.returncode == 0
        except FileNotFoundError:
            logger.error("nft command not found; unable to query blocked set")
            return False
        except Exception as exc:
            logger.error("Failed to query nftables for %s: %s", norm_mac, exc)
            return False

    def block_device(self, mac: str) -> bool:
        """
        Adds the specified MAC address to the nftables blocked_devices set.
        """
        norm_mac = normalize_mac(mac)
        logger.info("Blocking device %s", norm_mac)

        if self.dry_run:
            logger.info("[DRY-RUN] Would execute: nft add element %s %s { %s }", TABLE_NAME, SET_NAME, norm_mac)
            return True

        cmd = ["nft", "add", "element", "inet", "quota_manager", SET_NAME, f"{{ {norm_mac} }}"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if proc.returncode == 0:
                logger.info("Successfully added %s to %s", norm_mac, SET_NAME)
                return True
            else:
                logger.error("Failed to block %s via nftables: %s", norm_mac, proc.stderr.strip())
                return False
        except FileNotFoundError:
            logger.error("nft binary not found. Cannot block device %s", norm_mac)
            return False
        except Exception as exc:
            logger.error("Error executing nftables block for %s: %s", norm_mac, exc)
            return False

    def unblock_device(self, mac: str) -> bool:
        """
        Removes the specified MAC address from the nftables blocked_devices set.
        """
        norm_mac = normalize_mac(mac)
        logger.info("Unblocking device %s", norm_mac)

        if self.dry_run:
            logger.info("[DRY-RUN] Would execute: nft delete element %s %s { %s }", TABLE_NAME, SET_NAME, norm_mac)
            return True

        cmd = ["nft", "delete", "element", "inet", "quota_manager", SET_NAME, f"{{ {norm_mac} }}"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if proc.returncode == 0:
                logger.info("Successfully removed %s from %s", norm_mac, SET_NAME)
                return True
            else:
                # If element did not exist, nft returns non-zero, which is benign
                logger.debug("nft delete element returned: %s", proc.stderr.strip())
                return False
        except FileNotFoundError:
            logger.error("nft binary not found. Cannot unblock device %s", norm_mac)
            return False
        except Exception as exc:
            logger.error("Error executing nftables unblock for %s: %s", norm_mac, exc)
            return False

    def list_blocked_devices(self) -> List[str]:
        """
        Retrieves all MAC addresses currently inside the blocked_devices set.
        Supports both JSON output (nft -j) and plain text fallback.
        """
        if self.dry_run:
            logger.debug("[DRY-RUN] Returning empty blocked devices list")
            return []

        # 1. Try modern JSON output
        cmd_json = ["nft", "-j", "list", "set", "inet", "quota_manager", SET_NAME]
        try:
            proc = subprocess.run(cmd_json, capture_output=True, text=True, check=False)
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                for item in data.get("nftables", []):
                    if "set" in item and item["set"].get("name") == SET_NAME:
                        elements = item["set"].get("elem", [])
                        return [normalize_mac(str(elem)) for elem in elements if elem]
        except Exception:
            pass

        # 2. Fallback to regex parsing on plain text output
        cmd_plain = ["nft", "list", "set", "inet", "quota_manager", SET_NAME]
        try:
            proc = subprocess.run(cmd_plain, capture_output=True, text=True, check=False)
            if proc.returncode == 0:
                macs = re.findall(r"([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})", proc.stdout)
                return [normalize_mac(m) for m in macs]
        except FileNotFoundError:
            logger.error("nft binary not found. Cannot query blocked set")
        except Exception as exc:
            logger.error("Failed to list blocked devices via nftables: %s", exc)

        return []

    def print_status(self):
        """
        Displays a structured console overview of package and device statuses.
        """
        pkg = self.device_manager.get_package_info()
        devices = self.device_manager.get_devices()
        all_usage = self.usage_manager.get_all_devices_usage()
        blocked_macs = set(self.list_blocked_devices())

        print("\n" + "=" * 76)
        print("                 OPENWRT WI-FI QUOTA MANAGER STATUS                 ")
        print("=" * 76)

        if pkg:
            print(f"Subscription Package: {pkg.get('total_gb', 'N/A')} GB | "
                  f"Cycle: {pkg.get('start_date', 'N/A')} to {pkg.get('end_date', 'N/A')}")
            print("-" * 76)

        header = f"{'MAC Address':<18} | {'Device Name':<20} | {'Usage / Quota':<17} | {'State':<12}"
        print(header)
        print("-" * 76)

        if not devices:
            print("No devices configured in devices.json")
        else:
            for dev in devices:
                mac = dev["mac"]
                name = dev.get("name", "Unknown")[:20]
                quota_gb = float(dev.get("quota_gb", 0.0))
                enabled = bool(dev.get("enabled", True))
                usage_info = all_usage.get(mac, {})
                usage_gb = float(usage_info.get("total_gb", 0.0))

                # Determine display state
                if not enabled:
                    state = "[DISABLED]"
                elif mac in blocked_macs or usage_gb > quota_gb:
                    state = "[BLOCKED]"
                else:
                    state = "[ALLOWED]"

                quota_str = f"{usage_gb:.2f} / {quota_gb:.2f} GB"
                print(f"{mac:<18} | {name:<20} | {quota_str:<17} | {state:<12}")

        print("=" * 76 + "\n")

    def check_device_quota(self, device: Dict[str, Any], usage_gb: float) -> str:
        """
        Evaluates a device's quota and administrative status.
        Returns policy decision: 'allow' or 'block'.
        """
        mac = device["mac"]
        quota_gb = float(device.get("quota_gb", 0.0))
        enabled = bool(device.get("enabled", True))

        if not enabled:
            logger.warning("Device %s is administratively disabled", mac)
            return "block"

        if usage_gb > quota_gb:
            logger.warning("Device exceeded quota: %.2f GB > %.2f GB", usage_gb, quota_gb)
            return "block"

        logger.info("Device is within quota (%.2f GB / %.2f GB)", usage_gb, quota_gb)
        return "allow"

    def check_all_quotas(self) -> Dict[str, Any]:
        """
        Orchestrates full quota audit across all registered devices.
        Returns summary of actions performed.
        """
        logger.info("Starting Wi-Fi quota enforcement check...")

        try:
            devices = self.device_manager.get_devices()
        except Exception as exc:
            logger.error("Failed to load devices from configuration: %s", exc)
            return {"status": "error", "message": "Failed to load device config"}

        if not devices:
            logger.warning("No registered devices found in configuration")
            return {"status": "ok", "evaluated": 0, "blocked": 0, "allowed": 0}

        try:
            all_usage = self.usage_manager.get_all_devices_usage()
        except Exception as exc:
            logger.error("Failed to retrieve nlbwmon data: %s", exc)
            all_usage = {}

        summary = {
            "status": "ok",
            "evaluated": len(devices),
            "blocked": 0,
            "allowed": 0,
            "details": []
        }

        for dev in devices:
            mac = dev["mac"]
            name = dev.get("name", "Unknown Device")
            quota_gb = float(dev.get("quota_gb", 0.0))

            logger.info("Checking device %s (%s)", mac, name)

            # Extract current consumption
            dev_usage = all_usage.get(mac, {})
            usage_gb = float(dev_usage.get("total_gb", 0.0))

            logger.info("Usage: %.2f GB", usage_gb)
            logger.info("Quota: %.2f GB", quota_gb)

            action = self.check_device_quota(dev, usage_gb)

            if action == "block":
                self.block_device(mac)
                summary["blocked"] += 1
            else:
                # Device is under quota and enabled; ensure not blocked
                self.unblock_device(mac)
                summary["allowed"] += 1

            summary["details"].append({
                "mac": mac,
                "name": name,
                "usage_gb": usage_gb,
                "quota_gb": quota_gb,
                "decision": action
            })

        logger.info("Quota check completed. Evaluated: %d, Blocked: %d, Allowed: %d",
                    summary["evaluated"], summary["blocked"], summary["allowed"])
        return summary


def main():
    parser = argparse.ArgumentParser(description="OpenWrt Wi-Fi Quota Enforcement Engine")
    parser.add_argument("--config", type=str, help="Path to devices.json config file", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Simulate actions without modifying nftables")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose debug logging")
    parser.add_argument("--status", action="store_true", help="Display overview table of all devices and usage")
    parser.add_argument("--block", type=str, metavar="MAC", help="Manually block a specific MAC address")
    parser.add_argument("--unblock", type=str, metavar="MAC", help="Manually unblock a specific MAC address")
    parser.add_argument("--list-blocked", action="store_true", help="List all currently blocked MAC addresses in nftables")
    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)
        logging.getLogger("QuotaManager.Device").setLevel(logging.DEBUG)
        logging.getLogger("QuotaManager.Usage").setLevel(logging.DEBUG)

    if args.dry_run:
        logger.info("[DRY-RUN MODE ENABLED] No firewall rules will be modified")

    dev_mgr = DeviceManager(config_path=args.config)
    usage_mgr = UsageManager()
    checker = QuotaChecker(device_manager=dev_mgr, usage_manager=usage_mgr, dry_run=args.dry_run)

    # 1. Manual block action
    if args.block:
        try:
            norm_mac = normalize_mac(args.block)
            ok = checker.block_device(norm_mac)
            sys.exit(0 if ok else 1)
        except ValueError as err:
            logger.error("Invalid MAC address: %s", err)
            sys.exit(1)

    # 2. Manual unblock action
    if args.unblock:
        try:
            norm_mac = normalize_mac(args.unblock)
            ok = checker.unblock_device(norm_mac)
            sys.exit(0 if ok else 1)
        except ValueError as err:
            logger.error("Invalid MAC address: %s", err)
            sys.exit(1)

    # 3. List blocked action
    if args.list_blocked:
        blocked = checker.list_blocked_devices()
        print(f"\nCurrently Blocked Devices ({len(blocked)}):")
        for m in blocked:
            print(f"  - {m}")
        print()
        sys.exit(0)

    # 4. Status table display
    if args.status:
        checker.print_status()
        sys.exit(0)

    # Default action: Full quota check and enforcement audit
    results = checker.check_all_quotas()
    sys.exit(0 if results.get("status") == "ok" else 1)


if __name__ == "__main__":
    main()

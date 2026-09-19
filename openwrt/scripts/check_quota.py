#!/usr/bin/env python3
"""
Check Quota Engine
The core policy orchestration module for OpenWrt Wi-Fi Quota Manager.
Compares active bandwidth consumption against configured device allowances,
tracks quota warning thresholds (80%, 90%, 95%, 100%), and executes
access control via nftables.
"""

import argparse
import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Dict, Any, List, Optional, Set

# Ensure sibling modules can be imported directly
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

try:
    from openwrt.scripts.device_manager import DeviceManager, normalize_mac
    from openwrt.scripts.usage_manager import UsageManager, bytes_to_gb, convert_bytes, format_bytes
except (ImportError, ModuleNotFoundError):
    from device_manager import DeviceManager, normalize_mac  # type: ignore
    from usage_manager import UsageManager, bytes_to_gb, convert_bytes, format_bytes  # type: ignore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("QuotaManager.Core")

TABLE_NAME = "inet quota_manager"
SET_NAME = "blocked_devices"
DEFAULT_WARNING_THRESHOLDS = [80, 90, 95, 100]
STATE_FILE_PATH = "/tmp/quota_warning_state.json"


class WarningStateManager:
    """
    Manages persistent warning threshold states in /tmp/ (volatile RAM)
    to prevent duplicate notification spam every minute.
    """

    def __init__(self, state_path: str = STATE_FILE_PATH):
        self.state_path = Path(state_path)

    def load_state(self) -> Dict[str, List[int]]:
        """Loads triggered thresholds per device MAC."""
        if not self.state_path.exists():
            return {}
        try:
            with open(self.state_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def save_state(self, state: Dict[str, List[int]]) -> None:
        """Saves triggered thresholds atomically."""
        try:
            temp = self.state_path.with_suffix(".tmp")
            with open(temp, "w", encoding="utf-8") as f:
                json.dump(state, f)
            os.replace(temp, self.state_path)
        except Exception as exc:
            logger.error("Failed to save warning state: %s", exc)

    def get_triggered(self, mac: str) -> Set[int]:
        state = self.load_state()
        return set(state.get(mac, []))

    def record_triggered(self, mac: str, threshold: int) -> None:
        state = self.load_state()
        triggered = set(state.get(mac, []))
        triggered.add(threshold)
        state[mac] = sorted(list(triggered))
        self.save_state(state)

    def reset(self) -> None:
        """Clears all warning states for a new quota cycle."""
        try:
            if self.state_path.exists():
                self.state_path.unlink()
            logger.info("Warning threshold states successfully reset.")
        except Exception as exc:
            logger.error("Failed to reset warning states: %s", exc)


class QuotaChecker:
    """
    Coordinates between DeviceManager, UsageManager, and nftables.
    """

    def __init__(
        self,
        device_manager: DeviceManager,
        usage_manager: UsageManager,
        warning_manager: Optional[WarningStateManager] = None,
        warning_thresholds: Optional[List[int]] = None,
        dry_run: bool = False
    ):
        self.device_manager = device_manager
        self.usage_manager = usage_manager
        self.warning_manager = warning_manager or WarningStateManager()
        self.warning_thresholds = sorted(warning_thresholds or DEFAULT_WARNING_THRESHOLDS)
        self.dry_run = dry_run

    def is_device_blocked(self, mac: str) -> bool:
        """Checks if MAC address is currently in the nftables blocked_devices set."""
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
        """Adds the specified MAC address to the nftables blocked_devices set."""
        norm_mac = normalize_mac(mac)
        logger.info("Device blocked: %s", norm_mac)

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
        """Removes the specified MAC address from the nftables blocked_devices set."""
        norm_mac = normalize_mac(mac)
        logger.info("Device unblocked: %s", norm_mac)

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
                # Element not existing is benign
                logger.debug("nft delete element returned: %s", proc.stderr.strip())
                return False
        except FileNotFoundError:
            logger.error("nft binary not found. Cannot unblock device %s", norm_mac)
            return False
        except Exception as exc:
            logger.error("Error executing nftables unblock for %s: %s", norm_mac, exc)
            return False

    def list_blocked_devices(self) -> List[str]:
        """Retrieves all MAC addresses currently inside the blocked_devices set."""
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

    def evaluate_warnings(self, mac: str, usage_pct: float) -> List[int]:
        """
        Evaluates usage percentage against configured warning thresholds.
        Emits log events once per threshold per quota period.
        """
        triggered_now = []
        already_triggered = self.warning_manager.get_triggered(mac)

        for th in self.warning_thresholds:
            if usage_pct >= th and th not in already_triggered:
                logger.warning("Device reached %d%% quota: %s (Current: %.1f%%)", th, mac, usage_pct)
                self.warning_manager.record_triggered(mac, th)
                triggered_now.append(th)

        return triggered_now

    def calculate_device_metrics(self, device: Dict[str, Any], usage_info: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculates all usage metrics and access decisions for a device.
        """
        mac = device["mac"]
        name = device.get("name", "Unknown Device")
        quota_gb = float(device.get("quota_gb", 0.0))
        quota_bytes = int(quota_gb * (1024 ** 3))
        enabled = bool(device.get("enabled", True))

        total_bytes = int(usage_info.get("total_bytes", 0))
        download_bytes = int(usage_info.get("download_bytes", usage_info.get("rx_bytes", 0)))
        upload_bytes = int(usage_info.get("upload_bytes", usage_info.get("tx_bytes", 0)))

        usage_gb = bytes_to_gb(total_bytes)
        download_gb = bytes_to_gb(download_bytes)
        upload_gb = bytes_to_gb(upload_bytes)

        remaining_bytes = max(0, quota_bytes - total_bytes)
        remaining_gb = bytes_to_gb(remaining_bytes)

        if quota_bytes > 0:
            usage_percentage = round((total_bytes / quota_bytes) * 100.0, 1)
        else:
            usage_percentage = 0.0 if total_bytes == 0 else 100.0

        # Decision
        if not enabled:
            status = "disabled"
            decision = "block"
        elif total_bytes >= quota_bytes and quota_bytes > 0:
            status = "exceeded"
            decision = "block"
        else:
            status = "allowed"
            decision = "allow"

        return {
            "mac": mac,
            "name": name,
            "enabled": enabled,
            "status": status,
            "decision": decision,
            "quota_gb": quota_gb,
            "quota_bytes": quota_bytes,
            "usage_gb": usage_gb,
            "usage_bytes": total_bytes,
            "download_gb": download_gb,
            "download_bytes": download_bytes,
            "upload_gb": upload_gb,
            "upload_bytes": upload_bytes,
            "remaining_gb": remaining_gb,
            "remaining_bytes": remaining_bytes,
            "usage_percentage": usage_percentage,
            "formatted_usage": format_bytes(total_bytes),
            "formatted_quota": f"{quota_gb:.2f} GB"
        }

    def check_all_quotas(self) -> Dict[str, Any]:
        """
        Orchestrates full quota audit across all registered devices.
        Returns detailed execution summary.
        """
        logger.info("Starting Wi-Fi quota enforcement check...")

        try:
            devices = self.device_manager.get_devices()
        except Exception as exc:
            logger.error("Failed to load devices from configuration: %s", exc)
            return {"status": "error", "message": "Failed to load device config"}

        if not devices:
            logger.warning("No registered devices found in configuration")
            return {"status": "ok", "evaluated": 0, "blocked": 0, "allowed": 0, "details": []}

        try:
            all_usage = self.usage_manager.get_all_devices_usage()
        except Exception as exc:
            logger.error("Failed to retrieve nlbwmon data: %s", exc)
            all_usage = {}

        summary: Dict[str, Any] = {
            "status": "ok",
            "evaluated": len(devices),
            "blocked": 0,
            "allowed": 0,
            "details": []
        }

        for dev in devices:
            mac = dev["mac"]
            dev_usage = all_usage.get(mac, {})
            metrics = self.calculate_device_metrics(dev, dev_usage)

            # Warning threshold check
            if metrics["enabled"] and metrics["status"] != "disabled":
                self.evaluate_warnings(mac, metrics["usage_percentage"])

            # Access enforcement
            if metrics["decision"] == "block":
                if metrics["status"] == "exceeded":
                    logger.warning("Device quota exceeded: %s (%.2f GB / %.2f GB)",
                                   mac, metrics["usage_gb"], metrics["quota_gb"])
                self.block_device(mac)
                summary["blocked"] += 1
            else:
                self.unblock_device(mac)
                summary["allowed"] += 1

            summary["details"].append(metrics)

        logger.info("Quota check completed. Evaluated: %d, Blocked: %d, Allowed: %d",
                    summary["evaluated"], summary["blocked"], summary["allowed"])
        return summary

    def reset_quota_period(self) -> Dict[str, Any]:
        """
        Resets quota warning thresholds and unblocks devices previously blocked for quota exhaustion.
        """
        logger.info("Initiating quota cycle reset...")
        self.warning_manager.reset()

        devices = self.device_manager.get_devices()
        unblocked_count = 0
        for dev in devices:
            if dev.get("enabled", True):
                self.unblock_device(dev["mac"])
                unblocked_count += 1

        logger.info("Quota cycle reset complete. %d enabled devices unblocked.", unblocked_count)
        return {
            "status": "ok",
            "message": "Quota cycle reset successfully",
            "unblocked_devices": unblocked_count
        }

    def print_status(self) -> None:
        """Displays a structured terminal overview."""
        pkg = self.device_manager.get_package_info()
        devices = self.device_manager.get_devices()
        all_usage = self.usage_manager.get_all_devices_usage()
        blocked_macs = set(self.list_blocked_devices())

        print("\n" + "=" * 86)
        print("                      OPENWRT WI-FI QUOTA MANAGER STATUS                      ")
        print("=" * 86)

        if pkg:
            print(f"Subscription Package: {pkg.get('total_gb', 'N/A')} GB | "
                  f"Billing Period: {pkg.get('start_date', 'N/A')} to {pkg.get('end_date', 'N/A')}")
            print("-" * 86)

        header = f"{'MAC Address':<18} | {'Device Name':<18} | {'Usage / Quota':<18} | {'Pct':<6} | {'State':<10}"
        print(header)
        print("-" * 86)

        if not devices:
            print("No devices configured in devices.json")
        else:
            for dev in devices:
                mac = dev["mac"]
                dev_usage = all_usage.get(mac, {})
                metrics = self.calculate_device_metrics(dev, dev_usage)

                state_str = f"[{metrics['status'].upper()}]"
                quota_str = f"{metrics['usage_gb']:.2f} / {metrics['quota_gb']:.2f} GB"
                pct_str = f"{metrics['usage_percentage']:.0f}%"

                print(f"{mac:<18} | {metrics['name'][:18]:<18} | {quota_str:<18} | {pct_str:<6} | {state_str:<10}")

        print("=" * 86 + "\n")


def main():
    parser = argparse.ArgumentParser(description="OpenWrt Wi-Fi Quota Enforcement Engine")
    parser.add_argument("--config", type=str, help="Path to devices.json config file", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Simulate actions without modifying nftables")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose debug logging")
    parser.add_argument("--status", action="store_true", help="Display overview table of all devices and usage")
    parser.add_argument("--block", type=str, metavar="MAC", help="Manually block a specific MAC address")
    parser.add_argument("--unblock", type=str, metavar="MAC", help="Manually unblock a specific MAC address")
    parser.add_argument("--list-blocked", action="store_true", help="List all currently blocked MAC addresses in nftables")
    parser.add_argument("--reset", action="store_true", help="Reset billing period warning state and unblock devices")
    parser.add_argument("--json", action="store_true", help="Output audit results as JSON")
    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    if args.dry_run:
        logger.info("[DRY-RUN MODE ENABLED] No firewall rules will be modified")

    dev_mgr = DeviceManager(config_path=args.config)
    usage_mgr = UsageManager()
    checker = QuotaChecker(device_manager=dev_mgr, usage_manager=usage_mgr, dry_run=args.dry_run)

    if args.reset:
        result = checker.reset_quota_period()
        if args.json:
            print(json.dumps(result, indent=2))
        sys.exit(0)

    if args.block:
        try:
            norm_mac = normalize_mac(args.block)
            ok = checker.block_device(norm_mac)
            sys.exit(0 if ok else 1)
        except ValueError as err:
            logger.error("Invalid MAC address: %s", err)
            sys.exit(1)

    if args.unblock:
        try:
            norm_mac = normalize_mac(args.unblock)
            ok = checker.unblock_device(norm_mac)
            sys.exit(0 if ok else 1)
        except ValueError as err:
            logger.error("Invalid MAC address: %s", err)
            sys.exit(1)

    if args.list_blocked:
        blocked = checker.list_blocked_devices()
        if args.json:
            print(json.dumps({"blocked_devices": blocked}, indent=2))
        else:
            print(f"\nCurrently Blocked Devices ({len(blocked)}):")
            for m in blocked:
                print(f"  - {m}")
            print()
        sys.exit(0)

    if args.status:
        checker.print_status()
        sys.exit(0)

    results = checker.check_all_quotas()
    if args.json:
        print(json.dumps(results, indent=2))
    sys.exit(0 if results.get("status") == "ok" else 1)


if __name__ == "__main__":
    main()

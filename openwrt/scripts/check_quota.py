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

from device_manager import DeviceManager, normalize_mac
from usage_manager import UsageManager

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

    results = checker.check_all_quotas()
    sys.exit(0 if results.get("status") == "ok" else 1)


if __name__ == "__main__":
    main()

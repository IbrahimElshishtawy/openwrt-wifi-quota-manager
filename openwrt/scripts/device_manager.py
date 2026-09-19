#!/usr/bin/env python3
"""
Device Manager Module
Responsible for loading, updating, and saving device configurations (devices.json),
validating MAC addresses, and discovering live connected network clients from
OpenWrt DHCP leases (/tmp/dhcp.leases) and ARP tables (/proc/net/arp).
Decoupled from firewall rules and nftables operations.
"""

import json
import logging
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger("QuotaManager.Device")

MAC_REGEX = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")


def normalize_mac(mac: str) -> str:
    """Validates and normalizes MAC address to uppercase format with colons."""
    if not isinstance(mac, str) or not MAC_REGEX.match(mac.strip()):
        raise ValueError(f"Invalid MAC address format: {mac}")
    return mac.strip().replace("-", ":").upper()


class DeviceManager:
    """
    Manages configured device definitions and discovers live network clients.
    """

    def __init__(
        self,
        config_path: Optional[str] = None,
        dhcp_leases_path: str = "/tmp/dhcp.leases",
        arp_table_path: str = "/proc/net/arp"
    ):
        """
        Initializes DeviceManager.
        :param config_path: Absolute or relative path to devices.json.
        :param dhcp_leases_path: Path to dnsmasq leases file on OpenWrt.
        :param arp_table_path: Path to kernel ARP table.
        """
        if config_path:
            self.config_path = Path(config_path)
        else:
            # Default to openwrt/config/devices.json relative to project root
            base_dir = Path(__file__).resolve().parent.parent
            self.config_path = base_dir / "config" / "devices.json"

        self.dhcp_leases_path = Path(dhcp_leases_path)
        self.arp_table_path = Path(arp_table_path)

    def load_config(self) -> Dict[str, Any]:
        """
        Loads and parses the devices.json configuration file.
        Returns parsed JSON dict or default schema if missing/corrupt.
        """
        default_config = {
            "package": {
                "total_gb": 140,
                "start_date": "2026-09-01",
                "end_date": "2026-09-30"
            },
            "devices": []
        }

        if not self.config_path.exists():
            logger.warning("Configuration file not found: %s. Using default schema.", self.config_path)
            return default_config

        try:
            with open(self.config_path, "r", encoding="utf-8") as file:
                data = json.load(file)
                if not isinstance(data, dict):
                    logger.error("Configuration root must be a JSON object")
                    return default_config
                if "package" not in data:
                    data["package"] = default_config["package"]
                if "devices" not in data or not isinstance(data["devices"], list):
                    data["devices"] = []
                return data
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse configuration JSON: %s. Preserving original file.", exc)
            return default_config
        except Exception as exc:
            logger.error("Unexpected error reading config %s: %s", self.config_path, exc)
            return default_config

    def save_config(self, config: Dict[str, Any]) -> bool:
        """
        Safely saves configuration using atomic write (.tmp file + os.replace)
        to prevent JSON corruption during sudden power losses or reboots.
        """
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            temp_file = self.config_path.with_suffix(".tmp")

            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())

            os.replace(temp_file, self.config_path)
            logger.info("Successfully saved configuration to %s", self.config_path)
            return True
        except Exception as exc:
            logger.error("Failed to atomically save config to %s: %s", self.config_path, exc)
            return False

    def get_package_info(self) -> Dict[str, Any]:
        """Returns the internet subscription package configuration."""
        config = self.load_config()
        return config.get("package", {})

    def update_package(
        self,
        total_gb: Optional[float] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> bool:
        """Updates internet subscription package parameters."""
        config = self.load_config()
        pkg = config.setdefault("package", {})

        if total_gb is not None:
            if float(total_gb) <= 0:
                raise ValueError("Total package quota must be positive")
            pkg["total_gb"] = float(total_gb)

        if start_date is not None:
            pkg["start_date"] = str(start_date).strip()

        if end_date is not None:
            pkg["end_date"] = str(end_date).strip()

        return self.save_config(config)

    def get_devices(self) -> List[Dict[str, Any]]:
        """
        Returns the list of all configured devices with normalized MACs.
        Filters out entries with invalid MAC addresses or missing mandatory fields.
        """
        config = self.load_config()
        raw_devices = config.get("devices", [])
        validated_devices = []

        seen_macs = set()
        for dev in raw_devices:
            if not isinstance(dev, dict) or "mac" not in dev:
                continue

            try:
                norm_mac = normalize_mac(dev["mac"])
            except ValueError as err:
                logger.warning("Skipping device '%s': %s", dev.get("name", "Unknown"), err)
                continue

            if norm_mac in seen_macs:
                logger.warning("Duplicate MAC address detected and ignored: %s", norm_mac)
                continue

            seen_macs.add(norm_mac)

            validated_devices.append({
                "mac": norm_mac,
                "name": str(dev.get("name", "Unnamed Device")),
                "quota_gb": float(dev.get("quota_gb", 0.0)),
                "enabled": bool(dev.get("enabled", True))
            })

        return validated_devices

    def get_device(self, mac: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves a single configured device by MAC address.
        Returns None if not found or if MAC is invalid.
        """
        try:
            target_mac = normalize_mac(mac)
        except ValueError:
            return None

        for dev in self.get_devices():
            if dev["mac"] == target_mac:
                return dev

        return None

    def add_device(
        self,
        mac: str,
        name: str = "New Device",
        quota_gb: float = 10.0,
        enabled: bool = True
    ) -> bool:
        """
        Adds a new device or updates an existing one in devices.json.
        """
        norm_mac = normalize_mac(mac)
        quota_val = float(quota_gb)
        if quota_val < 0:
            raise ValueError("Quota cannot be negative")

        config = self.load_config()
        devices = config.setdefault("devices", [])

        # Check if already exists
        for dev in devices:
            if "mac" in dev:
                try:
                    if normalize_mac(dev["mac"]) == norm_mac:
                        dev["name"] = str(name)
                        dev["quota_gb"] = quota_val
                        dev["enabled"] = bool(enabled)
                        return self.save_config(config)
                except ValueError:
                    continue

        devices.append({
            "mac": norm_mac,
            "name": str(name),
            "quota_gb": quota_val,
            "enabled": bool(enabled)
        })
        return self.save_config(config)

    def update_device(
        self,
        mac: str,
        name: Optional[str] = None,
        quota_gb: Optional[float] = None,
        enabled: Optional[bool] = None
    ) -> bool:
        """
        Updates fields of an existing configured device.
        """
        norm_mac = normalize_mac(mac)
        config = self.load_config()
        devices = config.get("devices", [])

        found = False
        for dev in devices:
            if "mac" in dev:
                try:
                    if normalize_mac(dev["mac"]) == norm_mac:
                        if name is not None:
                            dev["name"] = str(name)
                        if quota_gb is not None:
                            quota_val = float(quota_gb)
                            if quota_val < 0:
                                raise ValueError("Quota cannot be negative")
                            dev["quota_gb"] = quota_val
                        if enabled is not None:
                            dev["enabled"] = bool(enabled)
                        found = True
                        break
                except ValueError:
                    continue

        if not found:
            logger.warning("Device %s not found in configuration for update", norm_mac)
            return False

        return self.save_config(config)

    def remove_device(self, mac: str) -> bool:
        """Removes a device from the configuration."""
        norm_mac = normalize_mac(mac)
        config = self.load_config()
        devices = config.get("devices", [])

        initial_len = len(devices)
        filtered = []
        for dev in devices:
            if "mac" in dev:
                try:
                    if normalize_mac(dev["mac"]) == norm_mac:
                        continue
                except ValueError:
                    pass
            filtered.append(dev)

        if len(filtered) == initial_len:
            logger.warning("Device %s not found for removal", norm_mac)
            return False

        config["devices"] = filtered
        return self.save_config(config)

    def is_device_enabled(self, mac: str) -> bool:
        """
        Checks whether the device is administratively enabled in configuration.
        Returns False if the device is explicitly disabled or not configured.
        """
        dev = self.get_device(mac)
        if not dev:
            logger.debug("Device %s is not registered in configuration", mac)
            return False
        return bool(dev.get("enabled", True))

    def discover_connected_devices(self) -> List[Dict[str, str]]:
        """
        Discovers currently connected clients by reading OpenWrt /tmp/dhcp.leases
        and /proc/net/arp.
        Returns a list of dicts: [{'mac': ..., 'ip': ..., 'hostname': ...}]
        """
        discovered: Dict[str, Dict[str, str]] = {}

        # 1. Parse dnsmasq leases file (/tmp/dhcp.leases)
        # Format: <timestamp> <mac> <ip> <hostname> <client_id>
        if self.dhcp_leases_path.exists():
            try:
                with open(self.dhcp_leases_path, "r", encoding="utf-8") as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) >= 4:
                            raw_mac, ip, hostname = parts[1], parts[2], parts[3]
                            try:
                                norm_mac = normalize_mac(raw_mac)
                                discovered[norm_mac] = {
                                    "mac": norm_mac,
                                    "ip": ip,
                                    "hostname": hostname if hostname != "*" else "Unknown"
                                }
                            except ValueError:
                                continue
            except Exception as exc:
                logger.error("Failed to read DHCP leases at %s: %s", self.dhcp_leases_path, exc)

        # 2. Parse ARP table (/proc/net/arp) to catch static IP clients
        # Format: IP HW_type Flags HW_address Mask Device
        if self.arp_table_path.exists():
            try:
                with open(self.arp_table_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()[1:]  # Skip header
                    for line in lines:
                        parts = line.strip().split()
                        if len(parts) >= 4:
                            ip, raw_mac = parts[0], parts[3]
                            if raw_mac == "00:00:00:00:00:00":
                                continue
                            try:
                                norm_mac = normalize_mac(raw_mac)
                                if norm_mac not in discovered:
                                    discovered[norm_mac] = {
                                        "mac": norm_mac,
                                        "ip": ip,
                                        "hostname": "Unknown"
                                    }
                            except ValueError:
                                continue
            except Exception as exc:
                logger.error("Failed to read ARP table at %s: %s", self.arp_table_path, exc)

        return list(discovered.values())


def main():
    """CLI utility for inspecting configured and discovered devices."""
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    mgr = DeviceManager()

    if len(sys.argv) > 1 and sys.argv[1] == "--json":
        output = {
            "package": mgr.get_package_info(),
            "configured_devices": mgr.get_devices(),
            "discovered_live_clients": mgr.discover_connected_devices()
        }
        print(json.dumps(output, indent=2))
        return

    print("\n--- Configured Devices ---")
    devices = mgr.get_devices()
    for d in devices:
        status = "ENABLED" if d["enabled"] else "DISABLED"
        print(f"  {d['mac']} | {d['name']:<20} | Quota: {d['quota_gb']:>6.1f} GB | {status}")

    print("\n--- Discovered Live Clients (DHCP / ARP) ---")
    discovered = mgr.discover_connected_devices()
    if not discovered:
        print("  (No active clients found in /tmp/dhcp.leases or /proc/net/arp)")
    else:
        for c in discovered:
            print(f"  {c['mac']} | IP: {c['ip']:<15} | Hostname: {c['hostname']}")
    print()


if __name__ == "__main__":
    main()

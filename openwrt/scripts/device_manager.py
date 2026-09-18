#!/usr/bin/env python3
"""
Device Manager Module
Responsible for loading configured devices, validating MAC addresses,
and discovering currently connected network clients from OpenWrt DHCP/ARP tables.
Decoupled from firewall rules and nftables operations.
"""

import json
import logging
import os
import re
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
        Returns parsed JSON dict or empty schema if missing/corrupt.
        """
        if not self.config_path.exists():
            logger.error("Configuration file not found: %s", self.config_path)
            return {"package": {}, "devices": []}

        try:
            with open(self.config_path, "r", encoding="utf-8") as file:
                data = json.load(file)
                if not isinstance(data, dict):
                    logger.error("Configuration root must be a JSON object")
                    return {"package": {}, "devices": []}
                return data
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse configuration JSON: %s", exc)
            return {"package": {}, "devices": []}
        except Exception as exc:
            logger.error("Unexpected error reading config %s: %s", self.config_path, exc)
            return {"package": {}, "devices": []}

    def get_package_info(self) -> Dict[str, Any]:
        """Returns the internet subscription package configuration."""
        config = self.load_config()
        return config.get("package", {})

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

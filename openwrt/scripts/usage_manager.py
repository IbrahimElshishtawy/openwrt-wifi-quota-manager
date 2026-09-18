#!/usr/bin/env python3
"""
Usage Manager Module
Responsible for retrieving and parsing bandwidth consumption metrics from nlbwmon.
Decoupled from quota evaluation logic and firewall control.
"""

import json
import logging
import os
import re
import subprocess
from typing import Dict, Any, Optional

logger = logging.getLogger("QuotaManager.Usage")

# Standard MAC address validation pattern
MAC_REGEX = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")


def normalize_mac(mac: str) -> str:
    """
    Validates and normalizes MAC address format to uppercase with colons.
    Example: 'aa-bb-cc-dd-ee-ff' -> 'AA:BB:CC:DD:EE:FF'
    """
    if not isinstance(mac, str) or not MAC_REGEX.match(mac.strip()):
        raise ValueError(f"Invalid MAC address format: {mac}")
    cleaned = mac.strip().replace("-", ":").upper()
    return cleaned


def bytes_to_gb(num_bytes: int) -> float:
    """Converts bytes to gigabytes (GB) rounded to 3 decimal places."""
    if num_bytes <= 0:
        return 0.0
    return round(num_bytes / (1024 ** 3), 3)


class UsageManager:
    """
    Interfaces with OpenWrt nlbwmon to extract per-device data consumption.
    """

    def __init__(self, mock_data: Optional[Dict[str, Any]] = None):
        """
        Initializes UsageManager.
        :param mock_data: Optional dictionary containing mock nlbwmon response for offline testing.
        """
        self.mock_data = mock_data

    def _query_nlbwmon_ubus(self) -> Optional[Dict[str, Any]]:
        """
        Executes 'ubus call nlbwmon query' safely without shell=True.
        Returns parsed JSON dict or None on failure.
        """
        if self.mock_data is not None:
            logger.debug("Using mock nlbwmon data")
            return self.mock_data

        cmd = ["ubus", "call", "nlbwmon", "query"]
        try:
            logger.debug("Executing ubus command: %s", " ".join(cmd))
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=5
            )
            if proc.returncode != 0:
                logger.error("Failed to query nlbwmon via ubus. Exit code: %d. Error: %s",
                             proc.returncode, proc.stderr.strip())
                return None

            output = proc.stdout.strip()
            if not output:
                logger.warning("Empty response received from nlbwmon ubus query")
                return None

            return json.loads(output)

        except FileNotFoundError:
            logger.error("Command 'ubus' not found. Ensure this is running on an OpenWrt system or provide mock data.")
            return None
        except subprocess.TimeoutExpired:
            logger.error("Timeout waiting for nlbwmon ubus query response")
            return None
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse nlbwmon JSON output: %s", exc)
            return None
        except Exception as exc:
            logger.error("Unexpected error querying nlbwmon: %s", exc)
            return None

    def get_all_devices_usage(self) -> Dict[str, Dict[str, Any]]:
        """
        Fetches consumption records for all devices from nlbwmon.
        Returns a dict mapping normalized MAC to usage statistics:
        {
            "AA:BB:CC:DD:EE:FF": {
                "mac": "AA:BB:CC:DD:EE:FF",
                "rx_bytes": 1073741824,
                "tx_bytes": 536870912,
                "total_bytes": 1610612736,
                "total_gb": 1.5
            }
        }
        """
        data = self._query_nlbwmon_ubus()
        usage_map: Dict[str, Dict[str, Any]] = {}

        if not data:
            logger.warning("No data retrieved from nlbwmon query")
            return usage_map

        # nlbwmon output format handles both column/rows structure and list of dicts
        # Format 1: {"columns": ["mac", "rx_bytes", "tx_bytes", ...], "rows": [...]}
        if "columns" in data and "rows" in data:
            columns = [col.lower() for col in data.get("columns", [])]
            rows = data.get("rows", [])

            mac_idx = columns.index("mac") if "mac" in columns else -1
            rx_idx = columns.index("rx_bytes") if "rx_bytes" in columns else -1
            tx_idx = columns.index("tx_bytes") if "tx_bytes" in columns else -1

            if mac_idx == -1:
                logger.error("Column 'mac' missing from nlbwmon output")
                return usage_map

            for row in rows:
                try:
                    raw_mac = str(row[mac_idx])
                    norm_mac = normalize_mac(raw_mac)
                except ValueError:
                    logger.debug("Skipping row with invalid MAC: %s", row[mac_idx] if len(row) > mac_idx else "")
                    continue

                rx_bytes = int(row[rx_idx]) if rx_idx != -1 and rx_idx < len(row) else 0
                tx_bytes = int(row[tx_idx]) if tx_idx != -1 and tx_idx < len(row) else 0
                total_bytes = rx_bytes + tx_bytes

                if norm_mac in usage_map:
                    # Aggregate if multiple entries exist (e.g. multiple IPs or subnets)
                    usage_map[norm_mac]["rx_bytes"] += rx_bytes
                    usage_map[norm_mac]["tx_bytes"] += tx_bytes
                    usage_map[norm_mac]["total_bytes"] += total_bytes
                    usage_map[norm_mac]["total_gb"] = bytes_to_gb(usage_map[norm_mac]["total_bytes"])
                else:
                    usage_map[norm_mac] = {
                        "mac": norm_mac,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "total_bytes": total_bytes,
                        "total_gb": bytes_to_gb(total_bytes)
                    }

        # Format 2: {"records": [{"mac": "...", "rx_bytes": ..., "tx_bytes": ...}, ...]}
        elif "records" in data or isinstance(data, list):
            records = data.get("records", []) if isinstance(data, dict) else data
            for record in records:
                if not isinstance(record, dict) or "mac" not in record:
                    continue
                try:
                    norm_mac = normalize_mac(record["mac"])
                except ValueError:
                    continue

                rx_bytes = int(record.get("rx_bytes", 0))
                tx_bytes = int(record.get("tx_bytes", 0))
                total_bytes = rx_bytes + tx_bytes

                if norm_mac in usage_map:
                    usage_map[norm_mac]["rx_bytes"] += rx_bytes
                    usage_map[norm_mac]["tx_bytes"] += tx_bytes
                    usage_map[norm_mac]["total_bytes"] += total_bytes
                    usage_map[norm_mac]["total_gb"] = bytes_to_gb(usage_map[norm_mac]["total_bytes"])
                else:
                    usage_map[norm_mac] = {
                        "mac": norm_mac,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "total_bytes": total_bytes,
                        "total_gb": bytes_to_gb(total_bytes)
                    }

        return usage_map

    def get_device_usage(self, mac: str) -> Dict[str, Any]:
        """
        Retrieves usage for a single device specified by MAC address.
        Returns empty usage metrics (0 bytes) if device has no recorded activity.
        """
        norm_mac = normalize_mac(mac)
        all_usage = self.get_all_devices_usage()
        if norm_mac in all_usage:
            return all_usage[norm_mac]

        return {
            "mac": norm_mac,
            "rx_bytes": 0,
            "tx_bytes": 0,
            "total_bytes": 0,
            "total_gb": 0.0
        }

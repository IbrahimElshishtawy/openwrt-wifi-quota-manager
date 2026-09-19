#!/usr/bin/env python3
"""
Usage Manager Module
Responsible for retrieving and parsing bandwidth consumption metrics from nlbwmon via ubus.
Decoupled from quota evaluation logic and firewall control.
"""

import json
import logging
import os
import re
import subprocess
import sys
from typing import Dict, Any, Optional, List, Union

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
    return mac.strip().replace("-", ":").upper()


def convert_bytes(num_bytes: int, target_unit: str = "GB") -> float:
    """
    Converts raw bytes to specified unit: 'B', 'KB', 'MB', 'GB'.
    Returns float rounded to 3 decimal places.
    """
    if num_bytes <= 0:
        return 0.0

    unit = target_unit.upper().strip()
    if unit in ("B", "BYTES"):
        return float(num_bytes)
    elif unit in ("KB", "KILOBYTES"):
        return round(num_bytes / 1024.0, 3)
    elif unit in ("MB", "MEGABYTES"):
        return round(num_bytes / (1024.0 ** 2), 3)
    elif unit in ("GB", "GIGABYTES"):
        return round(num_bytes / (1024.0 ** 3), 3)
    else:
        raise ValueError(f"Unsupported unit: {target_unit}. Use B, KB, MB, or GB.")


def bytes_to_gb(num_bytes: int) -> float:
    """Converts bytes to gigabytes (GB) rounded to 3 decimal places."""
    return convert_bytes(num_bytes, "GB")


def format_bytes(num_bytes: int) -> str:
    """
    Formats byte count into a human-readable string (e.g. '12.34 MB' or '1.50 GB').
    """
    if num_bytes <= 0:
        return "0.00 B"

    units = ["B", "KB", "MB", "GB", "TB"]
    val = float(num_bytes)
    idx = 0
    while val >= 1024.0 and idx < len(units) - 1:
        val /= 1024.0
        idx += 1
    return f"{val:.2f} {units[idx]}"


class UsageManager:
    """
    Interfaces with OpenWrt nlbwmon to extract per-device data consumption.
    """

    def __init__(self, mock_data: Optional[Union[Dict[str, Any], List[Any]]] = None):
        """
        Initializes UsageManager.
        :param mock_data: Optional dictionary or list containing mock nlbwmon response for offline testing.
        """
        self.mock_data = mock_data

    def _query_nlbwmon_ubus(self) -> Optional[Union[Dict[str, Any], List[Any]]]:
        """
        Executes 'ubus call nlbwmon query' safely without shell=True.
        Returns parsed JSON dict/list or None on failure.
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
        Returns a dict mapping normalized MAC to comprehensive usage statistics:
        {
            "AA:BB:CC:DD:EE:FF": {
                "mac": "AA:BB:CC:DD:EE:FF",
                "rx_bytes": 1073741824,
                "tx_bytes": 536870912,
                "download_bytes": 1073741824,
                "upload_bytes": 536870912,
                "total_bytes": 1610612736,
                "download_gb": 1.0,
                "upload_gb": 0.5,
                "total_gb": 1.5,
                "total_mb": 1536.0,
                "formatted": "1.50 GB"
            }
        }
        """
        data = self._query_nlbwmon_ubus()
        usage_map: Dict[str, Dict[str, Any]] = {}

        if not data:
            logger.warning("No data retrieved from nlbwmon query")
            return usage_map

        # Format 1: {"columns": ["mac", "rx_bytes", "tx_bytes", ...], "rows": [...]}
        if isinstance(data, dict) and "columns" in data and "rows" in data:
            columns = [col.lower() for col in data.get("columns", [])]
            rows = data.get("rows", [])

            mac_idx = columns.index("mac") if "mac" in columns else -1
            rx_idx = columns.index("rx_bytes") if "rx_bytes" in columns else -1
            tx_idx = columns.index("tx_bytes") if "tx_bytes" in columns else -1

            # Fallback column names used in some nlbwmon variants
            if rx_idx == -1 and "download_bytes" in columns:
                rx_idx = columns.index("download_bytes")
            if tx_idx == -1 and "upload_bytes" in columns:
                tx_idx = columns.index("upload_bytes")

            if mac_idx == -1:
                logger.error("Column 'mac' missing from nlbwmon output")
                return usage_map

            for row in rows:
                if not isinstance(row, list) or len(row) <= mac_idx:
                    continue

                try:
                    norm_mac = normalize_mac(str(row[mac_idx]))
                except ValueError:
                    continue

                rx_bytes = int(row[rx_idx]) if rx_idx != -1 and rx_idx < len(row) else 0
                tx_bytes = int(row[tx_idx]) if tx_idx != -1 and tx_idx < len(row) else 0
                total_bytes = rx_bytes + tx_bytes

                if norm_mac in usage_map:
                    usage_map[norm_mac]["rx_bytes"] += rx_bytes
                    usage_map[norm_mac]["tx_bytes"] += tx_bytes
                    usage_map[norm_mac]["download_bytes"] += rx_bytes
                    usage_map[norm_mac]["upload_bytes"] += tx_bytes
                    usage_map[norm_mac]["total_bytes"] += total_bytes
                else:
                    usage_map[norm_mac] = {
                        "mac": norm_mac,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "download_bytes": rx_bytes,
                        "upload_bytes": tx_bytes,
                        "total_bytes": total_bytes
                    }

        # Format 2: {"records": [{"mac": "...", "rx_bytes": ..., ...}]} or direct list
        elif (isinstance(data, dict) and "records" in data) or isinstance(data, list):
            records = data.get("records", []) if isinstance(data, dict) else data
            for record in records:
                if not isinstance(record, dict) or "mac" not in record:
                    continue
                try:
                    norm_mac = normalize_mac(str(record["mac"]))
                except ValueError:
                    continue

                rx_bytes = int(record.get("rx_bytes", record.get("download_bytes", 0)))
                tx_bytes = int(record.get("tx_bytes", record.get("upload_bytes", 0)))
                total_bytes = rx_bytes + tx_bytes

                if norm_mac in usage_map:
                    usage_map[norm_mac]["rx_bytes"] += rx_bytes
                    usage_map[norm_mac]["tx_bytes"] += tx_bytes
                    usage_map[norm_mac]["download_bytes"] += rx_bytes
                    usage_map[norm_mac]["upload_bytes"] += tx_bytes
                    usage_map[norm_mac]["total_bytes"] += total_bytes
                else:
                    usage_map[norm_mac] = {
                        "mac": norm_mac,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "download_bytes": rx_bytes,
                        "upload_bytes": tx_bytes,
                        "total_bytes": total_bytes
                    }

        # Populate calculated unit fields
        for mac, stats in usage_map.items():
            tot = stats["total_bytes"]
            stats["download_gb"] = bytes_to_gb(stats["download_bytes"])
            stats["upload_gb"] = bytes_to_gb(stats["upload_bytes"])
            stats["total_gb"] = bytes_to_gb(tot)
            stats["total_mb"] = convert_bytes(tot, "MB")
            stats["total_kb"] = convert_bytes(tot, "KB")
            stats["formatted"] = format_bytes(tot)

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
            "download_bytes": 0,
            "upload_bytes": 0,
            "total_bytes": 0,
            "download_gb": 0.0,
            "upload_gb": 0.0,
            "total_gb": 0.0,
            "total_mb": 0.0,
            "total_kb": 0.0,
            "formatted": "0.00 B"
        }


def main():
    """CLI helper to inspect live or mock usage directly on the router."""
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    mgr = UsageManager()

    if len(sys.argv) > 1 and sys.argv[1] == "--json":
        print(json.dumps(mgr.get_all_devices_usage(), indent=2))
        return

    usage = mgr.get_all_devices_usage()
    print(f"\n{'MAC Address':<18} | {'Download':<12} | {'Upload':<12} | {'Total':<12}")
    print("-" * 62)
    if not usage:
        print("No active bandwidth records found from nlbwmon.")
    else:
        for mac, data in usage.items():
            dl = format_bytes(data["download_bytes"])
            ul = format_bytes(data["upload_bytes"])
            tot = format_bytes(data["total_bytes"])
            print(f"{mac:<18} | {dl:<12} | {ul:<12} | {tot:<12}")
    print()


if __name__ == "__main__":
    main()

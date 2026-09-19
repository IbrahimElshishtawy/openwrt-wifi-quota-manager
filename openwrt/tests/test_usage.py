#!/usr/bin/env python3
"""
Unit tests for UsageManager module.
Verifies nlbwmon parsing, unit conversions, and resilient error handling.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from usage_manager import UsageManager, convert_bytes, bytes_to_gb, format_bytes, normalize_mac


class TestUsageManager(unittest.TestCase):
    """Test suite for bandwidth usage metrics parsing and unit formatting."""

    def test_convert_bytes(self):
        self.assertEqual(convert_bytes(0, "B"), 0.0)
        self.assertEqual(convert_bytes(-100, "MB"), 0.0)
        self.assertEqual(convert_bytes(1024, "KB"), 1.0)
        self.assertEqual(convert_bytes(1024 * 1024, "MB"), 1.0)
        self.assertEqual(convert_bytes(1024 ** 3, "GB"), 1.0)
        self.assertEqual(convert_bytes(int(1.5 * (1024 ** 3)), "GB"), 1.5)

        with self.assertRaises(ValueError):
            convert_bytes(1024, "INVALID_UNIT")

    def test_format_bytes(self):
        self.assertEqual(format_bytes(0), "0.00 B")
        self.assertEqual(format_bytes(-50), "0.00 B")
        self.assertEqual(format_bytes(512), "512.00 B")
        self.assertEqual(format_bytes(2048), "2.00 KB")
        self.assertEqual(format_bytes(5 * 1024 * 1024), "5.00 MB")
        self.assertEqual(format_bytes(int(2.5 * (1024 ** 3))), "2.50 GB")

    def test_parse_nlbwmon_columns_rows_format(self):
        mock_ubus_data = {
            "columns": ["mac", "ip", "rx_bytes", "tx_bytes"],
            "rows": [
                ["aa:bb:cc:dd:ee:ff", "192.168.1.10", 1073741824, 536870912],   # 1.0 GB dl, 0.5 GB ul = 1.5 GB
                ["11:22:33:44:55:66", "192.168.1.11", 5368709120, 5368709120],  # 5.0 GB dl, 5.0 GB ul = 10.0 GB
            ]
        }
        mgr = UsageManager(mock_data=mock_ubus_data)
        usage = mgr.get_all_devices_usage()

        self.assertIn("AA:BB:CC:DD:EE:FF", usage)
        self.assertIn("11:22:33:44:55:66", usage)

        dev1 = usage["AA:BB:CC:DD:EE:FF"]
        self.assertEqual(dev1["download_bytes"], 1073741824)
        self.assertEqual(dev1["upload_bytes"], 536870912)
        self.assertEqual(dev1["total_bytes"], 1610612736)
        self.assertEqual(dev1["total_gb"], 1.5)
        self.assertEqual(dev1["download_gb"], 1.0)
        self.assertEqual(dev1["upload_gb"], 0.5)

    def test_parse_nlbwmon_records_format(self):
        mock_ubus_data = {
            "records": [
                {"mac": "aa:bb:cc:dd:ee:ff", "rx_bytes": 2147483648, "tx_bytes": 1073741824}  # 3.0 GB
            ]
        }
        mgr = UsageManager(mock_data=mock_ubus_data)
        dev = mgr.get_device_usage("AA:BB:CC:DD:EE:FF")
        self.assertEqual(dev["total_gb"], 3.0)
        self.assertEqual(dev["download_gb"], 2.0)
        self.assertEqual(dev["upload_gb"], 1.0)

    def test_parse_nlbwmon_empty_and_corrupt(self):
        mgr = UsageManager(mock_data={})
        self.assertEqual(mgr.get_all_devices_usage(), {})

        mgr2 = UsageManager(mock_data={"columns": ["mac"], "rows": [["INVALID_MAC"]]})
        self.assertEqual(mgr2.get_all_devices_usage(), {})

    def test_nlbwmon_missing_ubus_handling(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            mgr = UsageManager(mock_data=None)
            usage = mgr.get_all_devices_usage()
            self.assertEqual(usage, {})

    def test_device_usage_zero_when_not_found(self):
        mgr = UsageManager(mock_data={})
        dev = mgr.get_device_usage("AA:BB:CC:DD:EE:FF")
        self.assertEqual(dev["total_bytes"], 0)
        self.assertEqual(dev["total_gb"], 0.0)


if __name__ == "__main__":
    unittest.main()

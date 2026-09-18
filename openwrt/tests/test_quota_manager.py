#!/usr/bin/env python3
"""
Comprehensive Unit Test Suite for OpenWrt Wi-Fi Quota Manager
Uses Python standard library unittest to ensure testability without third-party packages.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure scripts directory is in sys.path for standalone or on-router runs
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

try:
    from openwrt.scripts.device_manager import DeviceManager, normalize_mac
    from openwrt.scripts.usage_manager import UsageManager, bytes_to_gb
    from openwrt.scripts.check_quota import QuotaChecker
except (ImportError, ModuleNotFoundError):
    from device_manager import DeviceManager, normalize_mac  # type: ignore
    from usage_manager import UsageManager, bytes_to_gb      # type: ignore
    from check_quota import QuotaChecker                      # type: ignore


class TestMacValidation(unittest.TestCase):
    """Test suite for MAC address validation and normalization."""

    def test_valid_mac_with_colons(self):
        self.assertEqual(normalize_mac("aa:bb:cc:dd:ee:ff"), "AA:BB:CC:DD:EE:FF")
        self.assertEqual(normalize_mac("00:1A:2B:3C:4D:5E"), "00:1A:2B:3C:4D:5E")

    def test_valid_mac_with_hyphens(self):
        self.assertEqual(normalize_mac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF")

    def test_mac_with_surrounding_whitespace(self):
        self.assertEqual(normalize_mac("  aa:bb:cc:dd:ee:ff \n"), "AA:BB:CC:DD:EE:FF")

    def test_invalid_mac_formats(self):
        invalid_macs = [
            "",
            "invalid",
            "AA:BB:CC:DD:EE",         # only 5 octets
            "AA:BB:CC:DD:EE:FF:11",   # 7 octets
            "GG:BB:CC:DD:EE:FF",      # non-hexadecimal
            "AA-BB-CC-DD-EE",
            None,
            12345
        ]
        for bad_mac in invalid_macs:
            with self.subTest(bad_mac=bad_mac):
                with self.assertRaises(ValueError):
                    normalize_mac(bad_mac)


class TestUsageManager(unittest.TestCase):
    """Test suite for nlbwmon output parsing and metrics calculation."""

    def test_bytes_to_gb_conversion(self):
        self.assertEqual(bytes_to_gb(0), 0.0)
        self.assertEqual(bytes_to_gb(-500), 0.0)
        self.assertEqual(bytes_to_gb(1024 ** 3), 1.0)
        self.assertEqual(bytes_to_gb(int(1.5 * (1024 ** 3))), 1.5)

    def test_parse_nlbwmon_columns_rows_format(self):
        mock_ubus_data = {
            "columns": ["mac", "ip", "rx_bytes", "tx_bytes"],
            "rows": [
                ["aa:bb:cc:dd:ee:ff", "192.168.1.10", 1073741824, 536870912],  # 1.5 GB
                ["11:22:33:44:55:66", "192.168.1.11", 5368709120, 5368709120], # 10.0 GB
            ]
        }
        mgr = UsageManager(mock_data=mock_ubus_data)
        usage = mgr.get_all_devices_usage()

        self.assertIn("AA:BB:CC:DD:EE:FF", usage)
        self.assertIn("11:22:33:44:55:66", usage)

        dev1 = usage["AA:BB:CC:DD:EE:FF"]
        self.assertEqual(dev1["total_gb"], 1.5)
        self.assertEqual(dev1["rx_bytes"], 1073741824)
        self.assertEqual(dev1["tx_bytes"], 536870912)

        dev2 = usage["11:22:33:44:55:66"]
        self.assertEqual(dev2["total_gb"], 10.0)

    def test_parse_nlbwmon_records_format(self):
        mock_ubus_data = {
            "records": [
                {"mac": "aa:bb:cc:dd:ee:ff", "rx_bytes": 2147483648, "tx_bytes": 0}  # 2.0 GB
            ]
        }
        mgr = UsageManager(mock_data=mock_ubus_data)
        dev = mgr.get_device_usage("AA:BB:CC:DD:EE:FF")
        self.assertEqual(dev["total_gb"], 2.0)

    def test_device_usage_zero_when_not_found(self):
        mgr = UsageManager(mock_data={"columns": ["mac", "rx_bytes"], "rows": []})
        dev = mgr.get_device_usage("AA:BB:CC:DD:EE:FF")
        self.assertEqual(dev["total_gb"], 0.0)
        self.assertEqual(dev["total_bytes"], 0)

    def test_nlbwmon_unavailable_handling(self):
        # When ubus call fails (None returned)
        mgr = UsageManager(mock_data=None)
        with patch.object(mgr, "_query_nlbwmon_ubus", return_value=None):
            usage = mgr.get_all_devices_usage()
            self.assertEqual(usage, {})
            dev = mgr.get_device_usage("AA:BB:CC:DD:EE:FF")
            self.assertEqual(dev["total_gb"], 0.0)


class TestDeviceManager(unittest.TestCase):
    """Test suite for config parsing, lease discovery, and MAC lookups."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = Path(self.temp_dir.name) / "devices.json"
        self.leases_path = Path(self.temp_dir.name) / "dhcp.leases"
        self.arp_path = Path(self.temp_dir.name) / "arp"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_valid_config_loading(self):
        sample_config = {
            "package": {"total_gb": 100},
            "devices": [
                {"mac": "aa:bb:cc:dd:ee:ff", "name": "Phone", "quota_gb": 15.0, "enabled": True},
                {"mac": "11:22:33:44:55:66", "name": "Tablet", "quota_gb": 20.0, "enabled": False},
                {"mac": "INVALID-MAC", "name": "Corrupt", "quota_gb": 5.0, "enabled": True}  # Should be skipped
            ]
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(sample_config, f)

        dev_mgr = DeviceManager(config_path=str(self.config_path))
        devices = dev_mgr.get_devices()

        self.assertEqual(len(devices), 2)
        self.assertEqual(devices[0]["mac"], "AA:BB:CC:DD:EE:FF")
        self.assertTrue(devices[0]["enabled"])
        self.assertEqual(devices[1]["mac"], "11:22:33:44:55:66")
        self.assertFalse(devices[1]["enabled"])

    def test_duplicate_mac_in_config(self):
        duplicate_config = {
            "devices": [
                {"mac": "aa:bb:cc:dd:ee:ff", "name": "First", "quota_gb": 10.0},
                {"mac": "AA:BB:CC:DD:EE:FF", "name": "Second Duplicate", "quota_gb": 20.0}
            ]
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(duplicate_config, f)

        dev_mgr = DeviceManager(config_path=str(self.config_path))
        devices = dev_mgr.get_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["name"], "First")

    def test_missing_or_corrupt_config(self):
        # Missing file
        missing_mgr = DeviceManager(config_path=str(self.temp_dir.name + "/non_existent.json"))
        self.assertEqual(missing_mgr.get_devices(), [])

        # Corrupt file
        with open(self.config_path, "w") as f:
            f.write("NOT_JSON")
        corrupt_mgr = DeviceManager(config_path=str(self.config_path))
        self.assertEqual(corrupt_mgr.get_devices(), [])

    def test_is_device_enabled(self):
        config = {
            "devices": [
                {"mac": "aa:bb:cc:dd:ee:ff", "quota_gb": 10.0, "enabled": True},
                {"mac": "22:22:22:22:22:22", "quota_gb": 10.0, "enabled": False}
            ]
        }
        with open(self.config_path, "w") as f:
            json.dump(config, f)

        dev_mgr = DeviceManager(config_path=str(self.config_path))
        self.assertTrue(dev_mgr.is_device_enabled("AA:BB:CC:DD:EE:FF"))
        self.assertFalse(dev_mgr.is_device_enabled("22:22:22:22:22:22"))
        self.assertFalse(dev_mgr.is_device_enabled("99:99:99:99:99:99"))  # Unregistered

    def test_discover_connected_devices(self):
        # Mock /tmp/dhcp.leases
        with open(self.leases_path, "w") as f:
            f.write("1726694400 aa:bb:cc:dd:ee:ff 192.168.1.150 iPhone-14 01:aa:bb:cc:dd:ee:ff\n")
            f.write("1726694400 11:22:33:44:55:66 192.168.1.151 * 01:11:22:33:44:55:66\n")

        # Mock /proc/net/arp
        with open(self.arp_path, "w") as f:
            f.write("IP address       HW type     Flags       HW address            Mask     Device\n")
            f.write("192.168.1.150    0x1         0x2         aa:bb:cc:dd:ee:ff     *        br-lan\n")
            f.write("192.168.1.200    0x1         0x2         33:33:33:33:33:33     *        br-lan\n")

        dev_mgr = DeviceManager(
            config_path=str(self.config_path),
            dhcp_leases_path=str(self.leases_path),
            arp_table_path=str(self.arp_path)
        )
        discovered = dev_mgr.discover_connected_devices()
        macs = [d["mac"] for d in discovered]

        self.assertIn("AA:BB:CC:DD:EE:FF", macs)
        self.assertIn("11:22:33:44:55:66", macs)
        self.assertIn("33:33:33:33:33:33", macs)


class TestQuotaCheckerLogic(unittest.TestCase):
    """Test suite for quota evaluation, threshold boundary conditions, and action triggers."""

    def setUp(self):
        self.mock_dev_mgr = MagicMock(spec=DeviceManager)
        self.mock_usage_mgr = MagicMock(spec=UsageManager)
        self.checker = QuotaChecker(
            device_manager=self.mock_dev_mgr,
            usage_manager=self.mock_usage_mgr,
            dry_run=True
        )

    def test_device_under_quota(self):
        device = {"mac": "AA:BB:CC:DD:EE:FF", "quota_gb": 20.0, "enabled": True}
        decision = self.checker.check_device_quota(device, usage_gb=15.5)
        self.assertEqual(decision, "allow")

    def test_device_exactly_at_quota(self):
        device = {"mac": "AA:BB:CC:DD:EE:FF", "quota_gb": 20.0, "enabled": True}
        decision = self.checker.check_device_quota(device, usage_gb=20.0)
        self.assertEqual(decision, "allow")

    def test_device_over_quota(self):
        device = {"mac": "AA:BB:CC:DD:EE:FF", "quota_gb": 20.0, "enabled": True}
        decision = self.checker.check_device_quota(device, usage_gb=20.01)
        self.assertEqual(decision, "block")

    def test_device_administratively_disabled(self):
        device = {"mac": "AA:BB:CC:DD:EE:FF", "quota_gb": 50.0, "enabled": False}
        decision = self.checker.check_device_quota(device, usage_gb=1.0)
        self.assertEqual(decision, "block")

    def test_check_all_quotas_end_to_end(self):
        self.mock_dev_mgr.get_devices.return_value = [
            {"mac": "AA:BB:CC:DD:EE:FF", "name": "Phone 1", "quota_gb": 10.0, "enabled": True},
            {"mac": "11:22:33:44:55:66", "name": "Phone 2", "quota_gb": 10.0, "enabled": True},
            {"mac": "22:22:22:22:22:22", "name": "Disabled Device", "quota_gb": 10.0, "enabled": False}
        ]
        self.mock_usage_mgr.get_all_devices_usage.return_value = {
            "AA:BB:CC:DD:EE:FF": {"total_gb": 5.0},   # Under quota -> allow
            "11:22:33:44:55:66": {"total_gb": 12.0},  # Over quota -> block
            "22:22:22:22:22:22": {"total_gb": 0.0}    # Disabled -> block
        }

        with patch.object(self.checker, "block_device") as mock_block, \
             patch.object(self.checker, "unblock_device") as mock_unblock:

            summary = self.checker.check_all_quotas()

            self.assertEqual(summary["evaluated"], 3)
            self.assertEqual(summary["blocked"], 2)
            self.assertEqual(summary["allowed"], 1)

            mock_unblock.assert_called_once_with("AA:BB:CC:DD:EE:FF")
            mock_block.assert_any_call("11:22:33:44:55:66")
            mock_block.assert_any_call("22:22:22:22:22:22")

    def test_nftables_command_failure_handling(self):
        """Verify non-dry-run mode handles missing 'nft' binary gracefully."""
        live_checker = QuotaChecker(
            device_manager=self.mock_dev_mgr,
            usage_manager=self.mock_usage_mgr,
            dry_run=False
        )
        with patch("subprocess.run", side_effect=FileNotFoundError):
            result = live_checker.block_device("AA:BB:CC:DD:EE:FF")
            self.assertFalse(result)
            is_blocked = live_checker.is_device_blocked("AA:BB:CC:DD:EE:FF")
            self.assertFalse(is_blocked)


if __name__ == "__main__":
    unittest.main()

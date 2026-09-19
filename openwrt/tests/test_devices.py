#!/usr/bin/env python3
"""
Unit tests for DeviceManager module.
Verifies MAC validation, configuration loading/saving, atomic file operations,
CRUD methods, and DHCP/ARP parsing.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from device_manager import DeviceManager, normalize_mac


class TestDeviceManager(unittest.TestCase):
    """Test suite for device configuration and discovery operations."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_file = Path(self.temp_dir.name) / "devices.json"
        self.dhcp_file = Path(self.temp_dir.name) / "dhcp.leases"
        self.arp_file = Path(self.temp_dir.name) / "arp"

        # Initialize mock devices.json
        self.sample_config = {
            "package": {"total_gb": 150, "start_date": "2026-09-01", "end_date": "2026-09-30"},
            "devices": [
                {"mac": "aa:bb:cc:dd:ee:ff", "name": "Phone 1", "quota_gb": 15.0, "enabled": True},
                {"mac": "11:22:33:44:55:66", "name": "TV", "quota_gb": 50.0, "enabled": True},
                {"mac": "22:22:22:22:22:22", "name": "Disabled", "quota_gb": 10.0, "enabled": False}
            ]
        }
        with open(self.config_file, "w", encoding="utf-8") as f:
            json.dump(self.sample_config, f)

        # Initialize mock dhcp.leases
        with open(self.dhcp_file, "w", encoding="utf-8") as f:
            f.write("1726700000 aa:bb:cc:dd:ee:ff 192.168.1.100 Ahmed-iPhone 01:aa:bb:cc:dd:ee:ff\n")
            f.write("1726700000 11:22:33:44:55:66 192.168.1.101 SmartTV *\n")

        # Initialize mock /proc/net/arp
        with open(self.arp_file, "w", encoding="utf-8") as f:
            f.write("IP address       HW type     Flags       HW address            Mask     Device\n")
            f.write("192.168.1.1      0x1         0x2         c4:a3:66:5e:ff:48     *        br-lan\n")
            f.write("192.168.1.102    0x1         0x2         33:33:33:33:33:33     *        br-lan\n")

        self.mgr = DeviceManager(
            config_path=str(self.config_file),
            dhcp_leases_path=str(self.dhcp_file),
            arp_table_path=str(self.arp_file)
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_mac_normalization(self):
        self.assertEqual(normalize_mac("aa:bb:cc:dd:ee:ff"), "AA:BB:CC:DD:EE:FF")
        self.assertEqual(normalize_mac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF")
        self.assertEqual(normalize_mac("  00:1a:2b:3c:4d:5e \n"), "00:1A:2B:3C:4D:5E")

        invalid_macs = ["", "invalid", "AA:BB:CC", "GG:HH:II:JJ:KK:LL", None, 123]
        for bad in invalid_macs:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    normalize_mac(bad)

    def test_load_valid_config(self):
        devices = self.mgr.get_devices()
        self.assertEqual(len(devices), 3)
        macs = [d["mac"] for d in devices]
        self.assertIn("AA:BB:CC:DD:EE:FF", macs)
        self.assertIn("11:22:33:44:55:66", macs)
        self.assertIn("22:22:22:22:22:22", macs)

    def test_add_and_update_device(self):
        # Add new device
        ok = self.mgr.add_device("44:44:44:44:44:44", name="New Tablet", quota_gb=25.0, enabled=True)
        self.assertTrue(ok)
        dev = self.mgr.get_device("44:44:44:44:44:44")
        self.assertIsNotNone(dev)
        self.assertEqual(dev["name"], "New Tablet")
        self.assertEqual(dev["quota_gb"], 25.0)

        # Update existing device
        ok2 = self.mgr.update_device("44:44:44:44:44:44", name="Updated Tablet", quota_gb=30.0)
        self.assertTrue(ok2)
        dev2 = self.mgr.get_device("44:44:44:44:44:44")
        self.assertEqual(dev2["name"], "Updated Tablet")
        self.assertEqual(dev2["quota_gb"], 30.0)

    def test_remove_device(self):
        ok = self.mgr.remove_device("AA:BB:CC:DD:EE:FF")
        self.assertTrue(ok)
        self.assertIsNone(self.mgr.get_device("AA:BB:CC:DD:EE:FF"))
        self.assertEqual(len(self.mgr.get_devices()), 2)

    def test_update_package(self):
        ok = self.mgr.update_package(total_gb=200, start_date="2026-10-01", end_date="2026-10-31")
        self.assertTrue(ok)
        pkg = self.mgr.get_package_info()
        self.assertEqual(pkg["total_gb"], 200.0)
        self.assertEqual(pkg["start_date"], "2026-10-01")

    def test_discover_connected_devices(self):
        discovered = self.mgr.discover_connected_devices()
        macs = {d["mac"]: d for d in discovered}

        self.assertIn("AA:BB:CC:DD:EE:FF", macs)
        self.assertEqual(macs["AA:BB:CC:DD:EE:FF"]["ip"], "192.168.1.100")
        self.assertEqual(macs["AA:BB:CC:DD:EE:FF"]["hostname"], "Ahmed-iPhone")

        # Static client from ARP table
        self.assertIn("33:33:33:33:33:33", macs)
        self.assertEqual(macs["33:33:33:33:33:33"]["ip"], "192.168.1.102")


if __name__ == "__main__":
    unittest.main()

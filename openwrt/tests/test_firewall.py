#!/usr/bin/env python3
"""
Unit tests for nftables firewall control.
Verifies command construction, returncode handling, blocked set querying,
and graceful failure recovery using mock subprocess calls.
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from device_manager import DeviceManager
from usage_manager import UsageManager
from check_quota import QuotaChecker


class TestFirewallControl(unittest.TestCase):
    """Test suite for nftables driver in QuotaChecker."""

    def setUp(self):
        self.checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            dry_run=False
        )

    @patch("subprocess.run")
    def test_block_device_success(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ok = self.checker.block_device("aa:bb:cc:dd:ee:ff")
        self.assertTrue(ok)
        mock_run.assert_called_once_with(
            ["nft", "add", "element", "inet", "quota_manager", "blocked_devices", "{ AA:BB:CC:DD:EE:FF }"],
            capture_output=True,
            text=True,
            check=False
        )

    @patch("subprocess.run")
    def test_block_device_failure(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="Error: set full")
        ok = self.checker.block_device("aa:bb:cc:dd:ee:ff")
        self.assertFalse(ok)

    @patch("subprocess.run")
    def test_unblock_device_success(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        ok = self.checker.unblock_device("aa:bb:cc:dd:ee:ff")
        self.assertTrue(ok)
        mock_run.assert_called_once_with(
            ["nft", "delete", "element", "inet", "quota_manager", "blocked_devices", "{ AA:BB:CC:DD:EE:FF }"],
            capture_output=True,
            text=True,
            check=False
        )

    @patch("subprocess.run")
    def test_is_device_blocked(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        self.assertTrue(self.checker.is_device_blocked("aa:bb:cc:dd:ee:ff"))

        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="element not found")
        self.assertFalse(self.checker.is_device_blocked("aa:bb:cc:dd:ee:ff"))

    @patch("subprocess.run")
    def test_list_blocked_devices_json(self, mock_run):
        mock_nft_json = {
            "nftables": [
                {
                    "set": {
                        "family": "inet",
                        "name": "blocked_devices",
                        "table": "quota_manager",
                        "elem": ["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"]
                    }
                }
            ]
        }
        mock_run.return_value = MagicMock(returncode=0, stdout=json.dumps(mock_nft_json), stderr="")
        blocked = self.checker.list_blocked_devices()
        self.assertEqual(len(blocked), 2)
        self.assertIn("AA:BB:CC:DD:EE:FF", blocked)
        self.assertIn("11:22:33:44:55:66", blocked)

    @patch("subprocess.run")
    def test_missing_nft_binary_graceful_handling(self, mock_run):
        mock_run.side_effect = FileNotFoundError("nft not found")
        self.assertFalse(self.checker.block_device("aa:bb:cc:dd:ee:ff"))
        self.assertFalse(self.checker.unblock_device("aa:bb:cc:dd:ee:ff"))
        self.assertFalse(self.checker.is_device_blocked("aa:bb:cc:dd:ee:ff"))
        self.assertEqual(self.checker.list_blocked_devices(), [])

    def test_dry_run_does_not_execute_commands(self):
        dry_checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            dry_run=True
        )
        with patch("subprocess.run") as mock_run:
            self.assertTrue(dry_checker.block_device("aa:bb:cc:dd:ee:ff"))
            self.assertTrue(dry_checker.unblock_device("aa:bb:cc:dd:ee:ff"))
            self.assertFalse(dry_checker.is_device_blocked("aa:bb:cc:dd:ee:ff"))
            self.assertEqual(dry_checker.list_blocked_devices(), [])
            mock_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""
Unit tests for QuotaChecker and WarningStateManager.
Verifies quota arithmetic, percentage calculations, warning thresholds,
duplicate warning suppression, and billing period resets.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from device_manager import DeviceManager
from usage_manager import UsageManager
from check_quota import QuotaChecker, WarningStateManager


class TestQuotaLogic(unittest.TestCase):
    """Test suite for quota evaluation, calculations, and warning thresholds."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_file = Path(self.temp_dir.name) / "warning_state.json"
        self.warning_mgr = WarningStateManager(state_path=str(self.state_file))

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_calculate_device_metrics_under_quota(self):
        dev = {"mac": "AA:BB:CC:DD:EE:FF", "name": "Phone", "quota_gb": 10.0, "enabled": True}
        # 5.0 GB used
        usage = {"total_bytes": int(5.0 * (1024 ** 3)), "download_bytes": int(4.0 * (1024 ** 3)), "upload_bytes": int(1.0 * (1024 ** 3))}

        checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            warning_manager=self.warning_mgr,
            dry_run=True
        )

        metrics = checker.calculate_device_metrics(dev, usage)
        self.assertEqual(metrics["decision"], "allow")
        self.assertEqual(metrics["status"], "allowed")
        self.assertEqual(metrics["usage_gb"], 5.0)
        self.assertEqual(metrics["remaining_gb"], 5.0)
        self.assertEqual(metrics["usage_percentage"], 50.0)

    def test_calculate_device_metrics_exceeded_quota(self):
        dev = {"mac": "AA:BB:CC:DD:EE:FF", "name": "Phone", "quota_gb": 10.0, "enabled": True}
        # 12.0 GB used
        usage = {"total_bytes": int(12.0 * (1024 ** 3)), "download_bytes": int(10.0 * (1024 ** 3)), "upload_bytes": int(2.0 * (1024 ** 3))}

        checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            warning_manager=self.warning_mgr,
            dry_run=True
        )

        metrics = checker.calculate_device_metrics(dev, usage)
        self.assertEqual(metrics["decision"], "block")
        self.assertEqual(metrics["status"], "exceeded")
        self.assertEqual(metrics["remaining_gb"], 0.0)
        self.assertEqual(metrics["usage_percentage"], 120.0)

    def test_calculate_device_metrics_disabled_device(self):
        dev = {"mac": "AA:BB:CC:DD:EE:FF", "name": "Phone", "quota_gb": 10.0, "enabled": False}
        usage = {"total_bytes": 0}

        checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            warning_manager=self.warning_mgr,
            dry_run=True
        )

        metrics = checker.calculate_device_metrics(dev, usage)
        self.assertEqual(metrics["decision"], "block")
        self.assertEqual(metrics["status"], "disabled")

    def test_warning_thresholds_and_deduplication(self):
        checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            warning_manager=self.warning_mgr,
            warning_thresholds=[80, 90, 95, 100],
            dry_run=True
        )

        mac = "AA:BB:CC:DD:EE:FF"

        # 1. At 82%, should trigger 80% warning
        triggered = checker.evaluate_warnings(mac, 82.0)
        self.assertEqual(triggered, [80])

        # 2. Next minute still at 82%, should NOT re-trigger 80%
        triggered_again = checker.evaluate_warnings(mac, 82.0)
        self.assertEqual(triggered_again, [])

        # 3. Usage jumps to 96%, should trigger 90% and 95%
        triggered_jump = checker.evaluate_warnings(mac, 96.0)
        self.assertEqual(triggered_jump, [90, 95])

        # 4. Usage reaches 100%, should trigger 100%
        triggered_100 = checker.evaluate_warnings(mac, 100.5)
        self.assertEqual(triggered_100, [100])

        # 5. Subsequent run at 100% should trigger nothing
        self.assertEqual(checker.evaluate_warnings(mac, 101.0), [])

    def test_reset_quota_period(self):
        mac = "AA:BB:CC:DD:EE:FF"
        checker = QuotaChecker(
            device_manager=DeviceManager(),
            usage_manager=UsageManager(),
            warning_manager=self.warning_mgr,
            dry_run=True
        )

        # Trigger warning
        checker.evaluate_warnings(mac, 85.0)
        self.assertIn(80, self.warning_mgr.get_triggered(mac))

        # Reset period
        res = checker.reset_quota_period()
        self.assertEqual(res["status"], "ok")

        # Warning states should be empty now
        self.assertEqual(self.warning_mgr.get_triggered(mac), set())

        # Should be able to trigger 80% again after reset
        new_triggered = checker.evaluate_warnings(mac, 85.0)
        self.assertEqual(new_triggered, [80])


if __name__ == "__main__":
    unittest.main()

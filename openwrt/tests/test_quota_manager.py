#!/usr/bin/env python3
"""
Master Unit Test Suite for OpenWrt Wi-Fi Quota Manager
Executes all test modules across Usage, Devices, Quota Engine, Firewall, and REST API.
Uses standard library unittest exclusively for zero external dependencies.
"""

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = TESTS_DIR.parent / "scripts"
API_DIR = TESTS_DIR.parent / "api"

for path in (TESTS_DIR, SCRIPTS_DIR, API_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from test_usage import TestUsageManager
from test_devices import TestDeviceManager
from test_quota import TestQuotaLogic
from test_firewall import TestFirewallControl
from test_api import TestAPIEndpoints


def suite():
    loader = unittest.TestLoader()
    master_suite = unittest.TestSuite()
    master_suite.addTests(loader.loadTestsFromTestCase(TestUsageManager))
    master_suite.addTests(loader.loadTestsFromTestCase(TestDeviceManager))
    master_suite.addTests(loader.loadTestsFromTestCase(TestQuotaLogic))
    master_suite.addTests(loader.loadTestsFromTestCase(TestFirewallControl))
    master_suite.addTests(loader.loadTestsFromTestCase(TestAPIEndpoints))
    return master_suite


if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite())
    sys.exit(0 if result.wasSuccessful() else 1)

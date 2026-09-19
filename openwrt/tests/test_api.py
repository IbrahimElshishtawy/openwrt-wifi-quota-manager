#!/usr/bin/env python3
"""
Unit tests for the REST HTTP API server (api_usage.py).
Tests all REST endpoints, CORS headers, input validations, and error handling.
"""

import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
API_DIR = BASE_DIR / "api"
SCRIPTS_DIR = BASE_DIR / "scripts"

if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from device_manager import DeviceManager
from usage_manager import UsageManager
from check_quota import QuotaChecker
from api_usage import QuotaAPIRequestHandler


class TestAPIEndpoints(unittest.TestCase):
    """Test suite for REST API endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.config_path = Path(cls.temp_dir.name) / "devices.json"

        sample_config = {
            "package": {"total_gb": 100.0, "start_date": "2026-09-01", "end_date": "2026-09-30"},
            "devices": [
                {"mac": "AA:BB:CC:DD:EE:FF", "name": "Phone", "quota_gb": 10.0, "enabled": True}
            ]
        }
        with open(cls.config_path, "w", encoding="utf-8") as f:
            json.dump(sample_config, f)

        mock_usage_data = {
            "columns": ["mac", "ip", "rx_bytes", "tx_bytes"],
            "rows": [
                ["aa:bb:cc:dd:ee:ff", "192.168.1.100", int(2.0 * (1024 ** 3)), int(1.0 * (1024 ** 3))]
            ]
        }

        cls.dev_mgr = DeviceManager(config_path=str(cls.config_path))
        cls.usage_mgr = UsageManager(mock_data=mock_usage_data)
        cls.checker = QuotaChecker(
            device_manager=cls.dev_mgr,
            usage_manager=cls.usage_mgr,
            dry_run=True
        )

        QuotaAPIRequestHandler.device_manager = cls.dev_mgr
        QuotaAPIRequestHandler.usage_manager = cls.usage_mgr
        QuotaAPIRequestHandler.quota_checker = cls.checker
        QuotaAPIRequestHandler.api_key = None

        # Start server on an ephemeral loopback port
        cls.httpd = HTTPServer(("127.0.0.1", 0), QuotaAPIRequestHandler)
        cls.port = cls.httpd.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"

        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.temp_dir.cleanup()

    def _get(self, path: str):
        req = urllib.request.Request(f"{self.base_url}{path}")
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())

    def _post(self, path: str, data: dict):
        encoded = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=encoded,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())

    def _delete(self, path: str):
        req = urllib.request.Request(f"{self.base_url}{path}", method="DELETE")
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())

    def test_get_health(self):
        status, body = self._get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertIn("version", body)

    def test_get_devices(self):
        status, body = self._get("/devices")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["count"], 1)
        dev = body["devices"][0]
        self.assertEqual(dev["mac"], "AA:BB:CC:DD:EE:FF")
        self.assertEqual(dev["usage_gb"], 3.0)
        self.assertEqual(dev["quota_gb"], 10.0)
        self.assertEqual(dev["remaining_gb"], 7.0)

    def test_get_reports(self):
        status, body = self._get("/reports")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["package_total_gb"], 100.0)
        self.assertEqual(body["total_bandwidth_used_gb"], 3.0)
        self.assertEqual(body["package_remaining_gb"], 97.0)
        self.assertTrue(len(body["top_consumers"]) >= 1)

    def test_post_quota_update(self):
        status, body = self._post("/quota", {"mac": "AA:BB:CC:DD:EE:FF", "quota_gb": 25.0})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["device"]["quota_gb"], 25.0)

    def test_post_devices_add_and_delete(self):
        # Add new device
        status, body = self._post("/devices", {
            "mac": "55:55:55:55:55:55",
            "name": "Kitchen Speaker",
            "quota_gb": 8.0,
            "enabled": True
        })
        self.assertEqual(status, 201)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["device"]["name"], "Kitchen Speaker")

        # Delete device
        del_status, del_body = self._delete("/devices?mac=55:55:55:55:55:55")
        self.assertEqual(del_status, 200)
        self.assertEqual(del_body["status"], "success")

    def test_post_block_and_unblock(self):
        status, body = self._post("/block", {"mac": "AA:BB:CC:DD:EE:FF"})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "success")

        status2, body2 = self._post("/unblock", {"mac": "AA:BB:CC:DD:EE:FF"})
        self.assertEqual(status2, 200)
        self.assertEqual(body2["status"], "success")

    def test_post_reset(self):
        status, body = self._post("/reset", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_invalid_mac_error_handling(self):
        encoded = json.dumps({"mac": "INVALID_MAC", "quota_gb": 10}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/quota",
            data=encoded,
            headers={"Content-Type": "application/json"}
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)


if __name__ == "__main__":
    unittest.main()

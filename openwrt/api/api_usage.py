#!/usr/bin/env python3
"""
REST HTTP API Server for OpenWrt Wi-Fi Quota Manager
A lightweight, zero-dependency HTTP server built using Python's standard http.server.
Provides RESTful endpoints for the Flutter mobile application and local administrators
to monitor bandwidth consumption, configure quotas, manage devices, and control firewall states.
"""

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, date
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse, parse_qs

# Add scripts directory to path for imports
BASE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BASE_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

try:
    from device_manager import DeviceManager, normalize_mac
    from usage_manager import UsageManager, bytes_to_gb, format_bytes
    from check_quota import QuotaChecker, WarningStateManager
except ImportError:
    from openwrt.scripts.device_manager import DeviceManager, normalize_mac  # type: ignore
    from openwrt.scripts.usage_manager import UsageManager, bytes_to_gb, format_bytes  # type: ignore
    from openwrt.scripts.check_quota import QuotaChecker, WarningStateManager  # type: ignore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [API] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("QuotaManager.API")

VERSION = "1.0.0"


class QuotaAPIRequestHandler(BaseHTTPRequestHandler):
    """
    HTTP Request Handler serving RESTful endpoints for the Wi-Fi Quota Manager.
    """

    # Class-level shared dependencies
    device_manager: DeviceManager
    usage_manager: UsageManager
    quota_checker: QuotaChecker
    api_key: Optional[str] = None

    def log_message(self, format: str, *args: Any) -> None:
        """Redirect standard http.server request logging to standard logger."""
        logger.info("%s - %s", self.address_string(), format % args)

    # ------------------ CORS & Response Helpers ------------------ #

    def _send_cors_headers(self) -> None:
        """Sets CORS headers allowing web and mobile app integration."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_json_response(self, status_code: int, data: Any) -> None:
        """Sends a JSON response with appropriate headers and status code."""
        encoded = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(encoded)

    def _send_error(self, status_code: int, message: str) -> None:
        """Sends a structured JSON error response."""
        self._send_json_response(status_code, {
            "status": "error",
            "code": status_code,
            "message": message
        })

    def _check_auth(self) -> bool:
        """
        Validates the pre-shared API Key if one is configured.
        Returns True if authorized or authentication is disabled.
        """
        if not self.api_key:
            return True

        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            if token == self.api_key:
                return True

        self._send_error(401, "Unauthorized: Invalid or missing API Bearer token")
        return False

    def _parse_json_body(self) -> Optional[Dict[str, Any]]:
        """Parses and validates the JSON request body."""
        content_len_header = self.headers.get("Content-Length")
        if not content_len_header:
            self._send_error(400, "Missing Content-Length header")
            return None

        try:
            content_length = int(content_len_header)
            if content_length <= 0 or content_length > 1024 * 1024:  # Max 1MB
                self._send_error(400, "Invalid payload size")
                return None

            raw_body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(raw_body)
            if not isinstance(data, dict):
                self._send_error(400, "Request body must be a JSON object")
                return None
            return data
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_error(400, f"Malformed JSON body: {exc}")
            return None

    # ------------------ HTTP Methods ------------------ #

    def do_OPTIONS(self) -> None:
        """Handles CORS preflight requests."""
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        """Routes GET requests."""
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        if path == "" or path == "/health":
            self._handle_get_health()
        elif path == "/devices":
            self._handle_get_devices()
        elif path == "/reports":
            self._handle_get_reports()
        elif path == "/usage":
            self._handle_get_usage()
        elif path == "/blocked":
            self._handle_get_blocked()
        else:
            self._send_error(404, f"Endpoint not found: {path}")

    def do_POST(self) -> None:
        """Routes POST requests."""
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/quota":
            self._handle_post_quota()
        elif path == "/devices":
            self._handle_post_devices()
        elif path == "/devices/delete":
            self._handle_delete_devices()
        elif path == "/package":
            self._handle_post_package()
        elif path == "/block":
            self._handle_post_block()
        elif path == "/unblock":
            self._handle_post_unblock()
        elif path == "/reset":
            self._handle_post_reset()
        else:
            self._send_error(404, f"Endpoint not found: {path}")

    def do_DELETE(self) -> None:
        """Routes DELETE requests."""
        if not self._check_auth():
            return

        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        if path == "/devices":
            mac_list = query.get("mac", [])
            mac = mac_list[0] if mac_list else None
            self._handle_delete_devices(mac=mac)
        else:
            self._send_error(404, f"Endpoint not found: {path}")

    # ------------------ Endpoint Handlers ------------------ #

    def _handle_get_health(self) -> None:
        """GET /health - Simple service health and status check."""
        self._send_json_response(200, {
            "status": "ok",
            "service": "OpenWrt Wi-Fi Quota Manager API",
            "version": VERSION,
            "timestamp": datetime.now().isoformat()
        })

    def _handle_get_devices(self) -> None:
        """
        GET /devices - Returns all configured devices merged with real-time consumption,
        connection status (IP, hostname from DHCP leases), and access status.
        """
        devices = self.device_manager.get_devices()
        all_usage = self.usage_manager.get_all_devices_usage()
        blocked_macs = set(self.quota_checker.list_blocked_devices())

        # Map live DHCP/ARP leases by MAC
        live_clients = {
            c["mac"]: c for c in self.device_manager.discover_connected_devices()
        }

        enriched_devices = []
        for dev in devices:
            mac = dev["mac"]
            dev_usage = all_usage.get(mac, {})
            metrics = self.quota_checker.calculate_device_metrics(dev, dev_usage)

            live_info = live_clients.get(mac, {})
            is_blocked = (mac in blocked_macs) or (metrics["decision"] == "block")

            enriched_devices.append({
                "mac": mac,
                "name": dev["name"],
                "ip": live_info.get("ip", "Offline"),
                "hostname": live_info.get("hostname", "Unknown"),
                "quota_gb": metrics["quota_gb"],
                "usage_gb": metrics["usage_gb"],
                "download_gb": metrics["download_gb"],
                "upload_gb": metrics["upload_gb"],
                "remaining_gb": metrics["remaining_gb"],
                "usage_percentage": metrics["usage_percentage"],
                "enabled": metrics["enabled"],
                "status": metrics["status"],
                "is_blocked": is_blocked,
                "formatted_usage": metrics["formatted_usage"]
            })

        self._send_json_response(200, {
            "status": "success",
            "count": len(enriched_devices),
            "devices": enriched_devices
        })

    def _handle_get_reports(self) -> None:
        """
        GET /reports - Summarizes total ISP consumption, billing period, and top consumers.
        """
        pkg = self.device_manager.get_package_info()
        package_total_gb = float(pkg.get("total_gb", 0.0))
        start_date = pkg.get("start_date", "")
        end_date = pkg.get("end_date", "")

        devices = self.device_manager.get_devices()
        all_usage = self.usage_manager.get_all_devices_usage()

        total_bandwidth_bytes = 0
        device_rankings = []

        for dev in devices:
            mac = dev["mac"]
            dev_usage = all_usage.get(mac, {})
            usage_bytes = dev_usage.get("total_bytes", 0)
            total_bandwidth_bytes += usage_bytes

            device_rankings.append({
                "mac": mac,
                "name": dev["name"],
                "usage_bytes": usage_bytes,
                "usage_gb": bytes_to_gb(usage_bytes),
                "formatted": format_bytes(usage_bytes)
            })

        device_rankings.sort(key=lambda x: x["usage_bytes"], reverse=True)
        total_bandwidth_gb = bytes_to_gb(total_bandwidth_bytes)
        package_remaining_gb = max(0.0, round(package_total_gb - total_bandwidth_gb, 3))

        # Calculate remaining cycle days
        days_remaining = None
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
                today = date.today()
                days_remaining = max(0, (end_dt - today).days)
            except Exception:
                pass

        self._send_json_response(200, {
            "status": "success",
            "package": pkg,
            "package_total_gb": package_total_gb,
            "package_remaining_gb": package_remaining_gb,
            "total_bandwidth_used_gb": total_bandwidth_gb,
            "cycle_days_remaining": days_remaining,
            "top_consumers": device_rankings[:5]
        })

    def _handle_get_usage(self) -> None:
        """GET /usage - Returns raw/aggregated usage records from nlbwmon."""
        usage_data = self.usage_manager.get_all_devices_usage()
        self._send_json_response(200, {
            "status": "success",
            "count": len(usage_data),
            "usage": usage_data
        })

    def _handle_get_blocked(self) -> None:
        """GET /blocked - Lists MAC addresses currently blocked in nftables."""
        blocked = self.quota_checker.list_blocked_devices()
        self._send_json_response(200, {
            "status": "success",
            "count": len(blocked),
            "blocked_devices": blocked
        })

    def _handle_post_quota(self) -> None:
        """
        POST /quota - Updates quota allowance or toggle state for a device.
        Body: {"mac": "AA:BB:CC:DD:EE:FF", "quota_gb": 25.0, "enabled": true}
        """
        body = self._parse_json_body()
        if body is None:
            return

        raw_mac = body.get("mac")
        if not raw_mac:
            self._send_error(400, "Missing required field 'mac'")
            return

        try:
            norm_mac = normalize_mac(raw_mac)
        except ValueError as err:
            self._send_error(400, str(err))
            return

        quota_gb = body.get("quota_gb")
        enabled = body.get("enabled")

        if quota_gb is not None:
            try:
                quota_gb = float(quota_gb)
                if quota_gb < 0:
                    self._send_error(400, "quota_gb cannot be negative")
                    return
            except (ValueError, TypeError):
                self._send_error(400, "Invalid quota_gb value; must be a number")
                return

        if enabled is not None and not isinstance(enabled, bool):
            self._send_error(400, "enabled must be a boolean (true/false)")
            return

        # Check if device exists; if not, add it
        existing = self.device_manager.get_device(norm_mac)
        if not existing:
            ok = self.device_manager.add_device(
                mac=norm_mac,
                name=body.get("name", "New Device"),
                quota_gb=quota_gb if quota_gb is not None else 10.0,
                enabled=enabled if enabled is not None else True
            )
        else:
            ok = self.device_manager.update_device(
                mac=norm_mac,
                name=body.get("name"),
                quota_gb=quota_gb,
                enabled=enabled
            )

        if not ok:
            self._send_error(500, "Failed to update device quota in configuration")
            return

        # Immediately execute quota check for this device to adjust firewall
        updated_dev = self.device_manager.get_device(norm_mac)
        if updated_dev:
            dev_usage = self.usage_manager.get_device_usage(norm_mac)
            metrics = self.quota_checker.calculate_device_metrics(updated_dev, dev_usage)
            if metrics["decision"] == "block":
                self.quota_checker.block_device(norm_mac)
            else:
                self.quota_checker.unblock_device(norm_mac)

        self._send_json_response(200, {
            "status": "success",
            "message": "Quota updated successfully",
            "device": updated_dev
        })

    def _handle_post_devices(self) -> None:
        """
        POST /devices - Registers a new device or updates an existing one.
        Body: {"mac": "...", "name": "...", "quota_gb": ..., "enabled": ...}
        """
        body = self._parse_json_body()
        if body is None:
            return

        raw_mac = body.get("mac")
        if not raw_mac:
            self._send_error(400, "Missing field 'mac'")
            return

        try:
            norm_mac = normalize_mac(raw_mac)
        except ValueError as err:
            self._send_error(400, str(err))
            return

        name = str(body.get("name", "Unnamed Device")).strip()
        try:
            quota_gb = float(body.get("quota_gb", 10.0))
            if quota_gb < 0:
                self._send_error(400, "quota_gb cannot be negative")
                return
        except (ValueError, TypeError):
            self._send_error(400, "quota_gb must be a valid number")
            return

        enabled = bool(body.get("enabled", True))

        ok = self.device_manager.add_device(
            mac=norm_mac,
            name=name,
            quota_gb=quota_gb,
            enabled=enabled
        )

        if not ok:
            self._send_error(500, "Failed to save device")
            return

        self._send_json_response(201, {
            "status": "success",
            "message": "Device saved successfully",
            "device": self.device_manager.get_device(norm_mac)
        })

    def _handle_delete_devices(self, mac: Optional[str] = None) -> None:
        """
        DELETE /devices?mac=... or POST /devices/delete {"mac": "..."}
        Removes device and unblocks it from the firewall.
        """
        if not mac:
            body = self._parse_json_body()
            if body:
                mac = body.get("mac")

        if not mac:
            self._send_error(400, "Missing MAC address to delete")
            return

        try:
            norm_mac = normalize_mac(mac)
        except ValueError as err:
            self._send_error(400, str(err))
            return

        ok = self.device_manager.remove_device(norm_mac)
        if not ok:
            self._send_error(404, f"Device {norm_mac} not found in configuration")
            return

        # Ensure removed device is unblocked from firewall
        self.quota_checker.unblock_device(norm_mac)

        self._send_json_response(200, {
            "status": "success",
            "message": f"Device {norm_mac} deleted successfully"
        })

    def _handle_post_package(self) -> None:
        """
        POST /package - Updates ISP subscription package configuration.
        Body: {"total_gb": 300, "start_date": "2026-10-01", "end_date": "2026-10-31"}
        """
        body = self._parse_json_body()
        if body is None:
            return

        total_gb = body.get("total_gb")
        start_date = body.get("start_date")
        end_date = body.get("end_date")

        try:
            ok = self.device_manager.update_package(
                total_gb=total_gb,
                start_date=start_date,
                end_date=end_date
            )
        except ValueError as err:
            self._send_error(400, str(err))
            return

        if not ok:
            self._send_error(500, "Failed to update package information")
            return

        self._send_json_response(200, {
            "status": "success",
            "message": "Package configuration updated",
            "package": self.device_manager.get_package_info()
        })

    def _handle_post_block(self) -> None:
        """
        POST /block - Administratively blocks a device by MAC.
        Body: {"mac": "AA:BB:CC:DD:EE:FF"}
        """
        body = self._parse_json_body()
        if body is None:
            return

        raw_mac = body.get("mac")
        if not raw_mac:
            self._send_error(400, "Missing 'mac'")
            return

        try:
            norm_mac = normalize_mac(raw_mac)
        except ValueError as err:
            self._send_error(400, str(err))
            return

        ok = self.quota_checker.block_device(norm_mac)
        if not ok:
            self._send_error(500, f"Failed to block device {norm_mac} in nftables")
            return

        self._send_json_response(200, {
            "status": "success",
            "message": f"Device {norm_mac} blocked successfully",
            "mac": norm_mac
        })

    def _handle_post_unblock(self) -> None:
        """
        POST /unblock - Administratively unblocks a device by MAC.
        Body: {"mac": "AA:BB:CC:DD:EE:FF"}
        """
        body = self._parse_json_body()
        if body is None:
            return

        raw_mac = body.get("mac")
        if not raw_mac:
            self._send_error(400, "Missing 'mac'")
            return

        try:
            norm_mac = normalize_mac(raw_mac)
        except ValueError as err:
            self._send_error(400, str(err))
            return

        ok = self.quota_checker.unblock_device(norm_mac)
        if not ok:
            self._send_error(500, f"Failed to unblock device {norm_mac} in nftables")
            return

        self._send_json_response(200, {
            "status": "success",
            "message": f"Device {norm_mac} unblocked successfully",
            "mac": norm_mac
        })

    def _handle_post_reset(self) -> None:
        """
        POST /reset - Triggers billing period reset, clears warnings, and unblocks quota devices.
        """
        res = self.quota_checker.reset_quota_period()
        self._send_json_response(200, res)


def run_api_server(
    host: str = "0.0.0.0",
    port: int = 8080,
    config_path: Optional[str] = None,
    api_key: Optional[str] = None,
    dry_run: bool = False
) -> None:
    """Initializes and runs the API HTTP server."""
    dev_mgr = DeviceManager(config_path=config_path)
    usage_mgr = UsageManager()
    checker = QuotaChecker(device_manager=dev_mgr, usage_manager=usage_mgr, dry_run=dry_run)

    QuotaAPIRequestHandler.device_manager = dev_mgr
    QuotaAPIRequestHandler.usage_manager = usage_mgr
    QuotaAPIRequestHandler.quota_checker = checker
    QuotaAPIRequestHandler.api_key = api_key or os.environ.get("QUOTA_API_KEY")

    server_address = (host, port)
    httpd = HTTPServer(server_address, QuotaAPIRequestHandler)

    logger.info("Starting OpenWrt Wi-Fi Quota Manager API v%s", VERSION)
    logger.info("Listening on http://%s:%d (Dry Run: %s, Auth: %s)",
                host, port, dry_run, "Enabled" if QuotaAPIRequestHandler.api_key else "Disabled")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Stopping API server...")
    finally:
        httpd.server_close()
        logger.info("API server stopped.")


def main():
    parser = argparse.ArgumentParser(description="OpenWrt Wi-Fi Quota Manager REST API Server")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Binding host/IP (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--config", type=str, default=None, help="Path to devices.json")
    parser.add_argument("--api-key", type=str, default=None, help="Optional pre-shared API bearer key")
    parser.add_argument("--dry-run", action="store_true", help="Run without modifying nftables")
    args = parser.parse_args()

    run_api_server(
        host=args.host,
        port=args.port,
        config_path=args.config,
        api_key=args.api_key,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()

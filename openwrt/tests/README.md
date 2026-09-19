# Test Suite & Verification Subsystem (`openwrt/tests/`)

This directory contains comprehensive unit test suites and an automated diagnostic verification script for the OpenWrt router subsystem.

---

## 🧪 Test Architecture

All tests use Python's built-in `unittest` module and standard libraries exclusively, guaranteeing full execution capability on both developer workstations and minimal embedded routers without installing external test packages.

| Test File | Target Module | Scope & Capabilities |
| :--- | :--- | :--- |
| `test_usage.py` | `usage_manager.py` | nlbwmon columns/rows & records parsing, byte/GB/MB conversions, ubus missing/timeout error handling. |
| `test_devices.py` | `device_manager.py` | MAC validation, configuration CRUD, atomic write safety, `/tmp/dhcp.leases` & `/proc/net/arp` discovery. |
| `test_quota.py` | `check_quota.py` | Arithmetic calculations, percentage bounds, 80%/90%/95%/100% warning thresholds, deduplication, period reset. |
| `test_firewall.py` | `check_quota.py` | nftables command construction, element add/delete, blocked set querying, missing binary handling, dry-run safety. |
| `test_api.py` | `api_usage.py` | All 11 REST endpoints (`/health`, `/devices`, `/quota`, `/reports`, `/block`, `/unblock`, etc.), CORS, payload validation. |
| `test_quota_manager.py` | Master Suite | Aggregates all modular test suites into a single test runner. |
| `verify_openwrt.sh` | System Integration | Live automated audit script verifying 10 router subsystem criteria with clean `[PASS]`, `[FAIL]`, and `[NOT VERIFIED]` reports. |

---

## 🚀 Running Tests

### Run All Tests via unittest Discovery
```bash
python3 -m unittest discover -s openwrt/tests -p "test_*.py" -v
```

### Run Specific Test Module
```bash
python3 openwrt/tests/test_usage.py
python3 openwrt/tests/test_devices.py
python3 openwrt/tests/test_quota.py
python3 openwrt/tests/test_firewall.py
python3 openwrt/tests/test_api.py
```

### Run Master Test Runner
```bash
python3 openwrt/tests/test_quota_manager.py
```

### Run Automated System Verification Script
```bash
# On router or host workstation:
sh openwrt/tests/verify_openwrt.sh
```

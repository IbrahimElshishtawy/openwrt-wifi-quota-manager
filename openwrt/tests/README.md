# Tests Subsystem (`openwrt/tests/`)

This directory contains automated unit and integration tests for validating the OpenWrt Wi-Fi Quota Manager logic.

---

## 🧪 Test Scenarios Covered

The test suite validates:
1. **MAC Normalization & Format Validation**:
   - Standard colon formatting (`aa:bb:cc:dd:ee:ff` -> `AA:BB:CC:DD:EE:FF`).
   - Hyphen formatting (`aa-bb-cc-dd-ee-ff`).
   - Whitespace stripping.
   - Rejection of invalid octets, short MACs, long MACs, non-hex characters, and null values.
2. **Bandwidth Calculations**:
   - Accurate bytes-to-Gigabytes conversion.
   - Handling of negative or zero values.
3. **Usage Manager Parsing**:
   - `nlbwmon` column/row JSON format.
   - `nlbwmon` records JSON format.
   - Graceful fallback when `nlbwmon` is unavailable or returns an error.
4. **Device Manager Config & Discovery**:
   - Parsing valid `devices.json`.
   - Rejection of duplicate MAC entries.
   - Graceful recovery from missing or corrupted configuration.
   - Live client discovery via mock `/tmp/dhcp.leases` and `/proc/net/arp`.
5. **Quota Enforcement Logic**:
   - **Device under quota**: Status `allow`, unblock action triggered.
   - **Device exactly at quota**: Status `allow`.
   - **Device over quota**: Status `block`, added to `blocked_devices` set.
   - **Administratively disabled device**: Status `block`, regardless of usage.
   - **End-to-end full audit**: Verifies summary metrics and action calls.
   - **Fault tolerance**: Safe handling of `nft` binary failures without crashing.

---

## 🚀 Running the Tests

Tests use Python's built-in `unittest` runner. No virtual environments or external packages (`pytest`) are required:

```bash
# Run all tests from project root:
python3 -m unittest discover -s openwrt/tests -p "test_*.py" -v

# Or run test file directly:
python3 openwrt/tests/test_quota_manager.py -v
```

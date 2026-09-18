# Scripts Layer (`openwrt/scripts/`)

This directory contains the Python 3 core logic modules for the OpenWrt Wi-Fi Quota Manager. Each module adheres to strict single-responsibility principles and requires only the standard Python 3 runtime available on OpenWrt.

---

## 🐍 Modules Summary

### 1. `usage_manager.py`
- **Responsibility**: Queries `nlbwmon` via OpenWrt's IPC mechanism (`ubus call nlbwmon query`) and parses raw bandwidth statistics.
- **Key Functions**:
  - `get_device_usage(mac: str) -> dict`: Returns `{mac, rx_bytes, tx_bytes, total_bytes, total_gb}`.
  - `get_all_devices_usage() -> dict[str, dict]`: Maps normalized MACs to usage dictionaries.
  - `normalize_mac(mac: str) -> str`: Normalizes MAC format to uppercase with colons.

### 2. `device_manager.py`
- **Responsibility**: Loads configured devices from `openwrt/config/devices.json` and discovers live connected clients via `/tmp/dhcp.leases` and `/proc/net/arp`.
- **Key Functions**:
  - `get_devices() -> list[dict]`: Validated list of registered devices.
  - `get_device(mac: str) -> dict | None`: Lookup device by MAC.
  - `is_device_enabled(mac: str) -> bool`: Checks if device is enabled in config.
  - `discover_connected_devices() -> list[dict]`: Parses DHCP/ARP tables for live devices.

### 3. `check_quota.py`
- **Responsibility**: Quota policy enforcement loop. Compares device consumption against limits and updates the `nftables` `blocked_devices` set.
- **Key Methods**:
  - `check_device_quota(device, usage_gb) -> str`: Decides `"allow"` or `"block"`.
  - `block_device(mac: str) -> bool`: Adds MAC to `blocked_devices` set.
  - `unblock_device(mac: str) -> bool`: Deletes MAC from `blocked_devices` set.
  - `check_all_quotas() -> dict`: Executes a full audit cycle across all devices.

---

## 🚀 Execution & Command-Line Arguments

The main runner script is `check_quota.py`.

```bash
# Run in simulation mode (No nftables modifications)
python3 check_quota.py --dry-run --verbose

# Run with custom configuration file
python3 check_quota.py --config /path/to/custom_devices.json

# Standard execution (as run by cron or procd)
python3 check_quota.py
```

### CLI Options

| Argument | Description | Default |
| :--- | :--- | :--- |
| `--config <path>` | Path to custom `devices.json` configuration file | `../config/devices.json` |
| `--dry-run` | Log intended firewall changes without calling `nft` | `False` |
| `--verbose` | Enable `DEBUG` level log output | `False` (`INFO`) |

---

## 📋 Standardized Log Output

Scripts output structured logs adhering to OpenWrt syslog/logread standards:

```text
[INFO] Starting Wi-Fi quota enforcement check...
[INFO] Checking device AA:BB:CC:DD:EE:FF (Ahmed Phone)
[INFO] Usage: 18.20 GB
[INFO] Quota: 20.00 GB
[INFO] Device is within quota (18.20 GB / 20.00 GB)
[INFO] Unblocking device AA:BB:CC:DD:EE:FF
[WARNING] Device exceeded quota: 52.30 GB > 50.00 GB
[INFO] Blocking device 11:22:33:44:55:66
[INFO] Quota check completed. Evaluated: 2, Blocked: 1, Allowed: 1
```

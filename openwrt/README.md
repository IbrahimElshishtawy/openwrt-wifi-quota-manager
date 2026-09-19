# OpenWrt Wi-Fi Quota Manager — Router Layer

The router-side subsystem for **OpenWrt Wi-Fi Quota Manager**. This layer executes directly on OpenWrt firmware and is responsible for device discovery, bandwidth/usage monitoring (`nlbwmon`), quota calculation, warning threshold evaluation, firewall-level access enforcement (`nftables`), and exposing a lightweight REST HTTP API for the Flutter mobile application.

---

## 📁 Directory Structure

```text
openwrt/
├── README.md               # Main overview and setup guide
├── install.sh              # 1-command installer script for OpenWrt
├── uninstall.sh            # Clean uninstaller script for OpenWrt
├── deploy.sh               # SSH/SCP deployment script to push code to router
├── config/                 # Device and quota configuration
│   ├── README.md           # Configuration schema and guide
│   └── devices.json        # Active configuration file
├── scripts/                # Core modular Python scripts
│   ├── README.md           # Execution guide and CLI parameters
│   ├── check_quota.py      # Core quota enforcement engine & CLI
│   ├── device_manager.py   # Device discovery, CRUD & lease parser
│   ├── usage_manager.py    # nlbwmon query, usage parser & unit conversion
│   └── simulate.py         # Offline full workflow simulator
├── nftables/               # Firewall rules and access control sets
│   ├── README.md           # Rule loading and set manipulation guide
│   └── rules.nft           # nftables table and set definitions
├── api/                    # REST HTTP API for Flutter mobile client
│   ├── README.md           # API specification and endpoints
│   └── api_usage.py        # Zero-dependency Python http.server REST API
├── services/               # System service integration (procd)
│   ├── README.md           # OpenWrt procd service guide
│   └── quota-manager.init  # procd init.d script managing API and firewall
├── cron/                   # Periodic job automation
│   ├── README.md           # Crontab setup and best practices
│   └── quota-manager.cron  # 1-minute crontab schedule definition
├── tests/                  # Unit and integration tests
│   ├── README.md           # Testing instructions
│   ├── verify_openwrt.sh   # Automated system verification diagnostic script
│   ├── test_usage.py       # Unit tests for usage_manager
│   ├── test_devices.py     # Unit tests for device_manager
│   ├── test_quota.py       # Unit tests for check_quota & warning thresholds
│   ├── test_firewall.py    # Unit tests for nftables control
│   ├── test_api.py         # Unit tests for REST API endpoints
│   └── test_quota_manager.py # Master unit test suite aggregator
└── docs/                   # Technical documentation
    ├── architecture.md     # Component architecture and diagrams
    ├── workflow.md         # Traffic and lifecycle workflows
    ├── installation.md     # Step-by-step router installation manual
    ├── verification.md     # System audit and verification report
    └── troubleshooting.md  # Common issues and remediation
```

---

## 🚀 Quick Start & Deployment

### Option A: 1-Command Push from Computer to Router (`deploy.sh`)

From your development machine, push the whole subsystem directly to the router:

```bash
# Push to router (defaults to 192.168.1.1)
./openwrt/deploy.sh 192.168.1.1
```

### Option B: Direct Installation on OpenWrt Router (`install.sh`)

SSH into your router and run:

```bash
# 1. Clone or copy openwrt/ to /root/openwrt-wifi-quota-manager/openwrt
cd /root/openwrt-wifi-quota-manager/openwrt

# 2. Run automated installer
sh install.sh
```

The installer automatically:
- Verifies and installs `python3-base`, `nlbwmon`, and `nftables`.
- Configures and enables the `nlbwmon` daemon.
- Copies and initializes the `inet quota_manager` table in `nftables`.
- Installs and enables the `/etc/init.d/quota-manager` procd service (supervising the API daemon on port 8080).
- Configures cron (`/etc/crontabs/root`) to run enforcement every minute.
- Executes `tests/verify_openwrt.sh` to output initial verification status.

---

## 🌐 REST HTTP API (`api_usage.py`)

The subsystem provides a lightweight REST API running on port 8080 for the Flutter application:

```bash
# Start manually or inspect:
python3 openwrt/api/api_usage.py --port 8080
```

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health status and version |
| `GET` | `/devices` | Enriched device list with live usage, quota, and IP |
| `POST` | `/quota` | Adjust quota limit or toggle device access |
| `POST` | `/devices` | Register new device or update existing |
| `DELETE` | `/devices?mac=...` | Remove device from configuration & unblock |
| `GET` | `/reports` | Bandwidth consumption breakdown & top consumers |
| `POST` | `/package` | Update overall ISP subscription parameters |
| `GET` | `/usage` | Real-time usage metrics from `nlbwmon` |
| `GET` | `/blocked` | List MAC addresses currently blocked in `nftables` |
| `POST` | `/block` | Administratively block a device MAC |
| `POST` | `/unblock` | Administratively unblock a device MAC |
| `POST` | `/reset` | Clear warning states and reset billing period |

---

## 🎮 CLI Management (`check_quota.py`)

You can run `check_quota.py` directly from the terminal:

```bash
# View real-time status table of all devices, usage, and firewall state:
python3 openwrt/scripts/check_quota.py --status

# Run quota audit in dry-run mode (no firewall changes):
python3 openwrt/scripts/check_quota.py --dry-run --verbose

# Manually block a specific MAC:
python3 openwrt/scripts/check_quota.py --block AA:BB:CC:DD:EE:FF

# Manually unblock a specific MAC:
python3 openwrt/scripts/check_quota.py --unblock AA:BB:CC:DD:EE:FF

# List all currently blocked MACs in nftables:
python3 openwrt/scripts/check_quota.py --list-blocked

# Reset quota period and warning states:
python3 openwrt/scripts/check_quota.py --reset
```

---

## 🧪 Testing & Automated Verification

### 1. Run Complete Unit Test Suite (66 tests)
```bash
python3 -m unittest discover -s openwrt/tests -p "test_*.py" -v
```

### 2. Run Offline Lifecycle Simulator
```bash
python3 openwrt/scripts/simulate.py
```

### 3. Run Automated System Diagnostic Script
```bash
sh openwrt/tests/verify_openwrt.sh
```

---

## ⚡ Key Architectural Principles

1. **OpenWrt First**: Designed specifically for embedded Linux routers running OpenWrt 22.03+ / 23.05+ with native `nftables` (`fw4`) and `ubus`.
2. **Zero Bloat (Standard Library Only)**: Uses only built-in Python 3 modules (`json`, `subprocess`, `re`, `logging`, `pathlib`, `argparse`, `datetime`, `http.server`). Fits on resource-constrained flash memory (16MB+).
3. **Warning Deduplication**: Warning thresholds (80%, 90%, 95%, 100%) trigger log events once per quota period, stored in volatile RAM (`/tmp/quota_warning_state.json`).
4. **Hardened Security & Safety**:
   - Strict MAC address format validation (`XX:XX:XX:XX:XX:XX`).
   - Forward chain hook only: router management access (SSH port 22, LuCI HTTP/HTTPS, DNS, DHCP) is never blocked.
   - Dedicated table `inet quota_manager` prevents interference with standard router firewall rules.
   - Atomic file writes prevent JSON corruption during sudden power losses.

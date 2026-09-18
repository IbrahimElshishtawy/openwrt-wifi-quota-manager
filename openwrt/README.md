# OpenWrt Wi-Fi Quota Manager - Router Layer

The router-side subsystem for **OpenWrt Wi-Fi Quota Manager**. This layer executes directly on OpenWrt firmware and is responsible for device discovery, bandwidth/usage monitoring (`nlbwmon`), quota calculation, and firewall-level access enforcement (`nftables`).

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
│   ├── device_manager.py   # Device discovery and config reader
│   ├── usage_manager.py    # nlbwmon query and usage parser
│   └── simulate.py         # Offline full workflow simulator
├── nftables/               # Firewall rules and access control sets
│   ├── README.md           # Rule loading and set manipulation guide
│   └── rules.nft           # nftables table and set definitions
├── api/                    # Future local REST API placeholder
│   └── README.md           # API specification and security design
├── services/               # System service integration (procd)
│   ├── README.md           # OpenWrt procd service guide
│   └── quota-manager.init  # procd init.d script template
├── cron/                   # Periodic job automation
│   └── README.md           # Crontab setup and best practices
├── tests/                  # Unit and integration tests
│   ├── README.md           # Testing instructions
│   └── test_quota_manager.py# Offline test suite (standard unittest)
└── docs/                   # Technical documentation
    ├── architecture.md     # Component architecture and diagrams
    ├── workflow.md         # Traffic and lifecycle workflows
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
- Installs and enables the `/etc/init.d/quota-manager` procd service.
- Configures cron (`/etc/crontabs/root`) to run enforcement every minute.

---

## 🎮 CLI Management (`check_quota.py`)

You can run `check_quota.py` directly from the OpenWrt terminal:

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
```

---

## 🧪 Testing & Local Simulation (Without a Router)

You can test and simulate the entire OpenWrt quota lifecycle on your development machine:

```bash
# Run unit test suite (20 tests):
python3 -m unittest discover -s openwrt/tests -p "test_*.py" -v

# Run interactive offline simulator:
python3 openwrt/scripts/simulate.py
```

---

## ⚡ Key Architectural Principles

1. **OpenWrt First**: Designed specifically for embedded Linux routers running OpenWrt 22.03+ / 23.05+ with native `nftables` (`fw4`) and `ubus`.
2. **Zero Bloat (Standard Library Only)**: Uses only built-in Python 3 modules (`json`, `subprocess`, `re`, `logging`, `pathlib`, `argparse`, `datetime`). Fits on resource-constrained flash memory (16MB+).
3. **Modular & Decoupled**: Network access control (`nftables`), bandwidth accounting (`nlbwmon`), and configuration are strictly separated into independent modules.
4. **Hardened Security**:
   - Strict MAC address format validation (`XX:XX:XX:XX:XX:XX`).
   - Safe process execution (`subprocess.run` with list arguments, `shell=False`) to prevent command injection.
   - Read-only operations for querying; atomic updates for blocking/unblocking.
5. **Auditable Logging**: Standardized log format (`[INFO]`, `[WARNING]`, `[ERROR]`) compatible with console output, syslog, and `logread`.

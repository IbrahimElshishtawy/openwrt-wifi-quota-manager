# OpenWrt Wi-Fi Quota Manager - Router Layer

The router-side subsystem for **OpenWrt Wi-Fi Quota Manager**. This layer executes directly on OpenWrt firmware and is responsible for device discovery, bandwidth/usage monitoring (`nlbwmon`), quota calculation, and firewall-level access enforcement (`nftables`).

---

## 📁 Directory Structure

```text
openwrt/
├── README.md               # Main overview and setup guide
├── config/                 # Device and quota configuration
│   ├── README.md           # Configuration schema and guide
│   └── devices.json        # Active configuration file
├── scripts/                # Core modular Python scripts
│   ├── README.md           # Execution guide and CLI parameters
│   ├── check_quota.py      # Core quota enforcement engine
│   ├── device_manager.py   # Device discovery and config reader
│   └── usage_manager.py    # nlbwmon query and usage parser
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

## 🛠 Prerequisites on OpenWrt

Ensure your OpenWrt router has an active SSH connection and updated package index:

```bash
# Update package repositories
opkg update

# Install required packages
# Note: Python standard library is sufficient; no pip/third-party packages needed.
opkg install python3-base python3-light nlbwmon nftables

# Enable and start nlbwmon service
/etc/init.d/nlbwmon enable
/etc/init.d/nlbwmon start
```

#./scripts/check_quota.py 5000 /tmp/devices.json

## ⚡ Key Architectural Principles

1. **OpenWrt First**: Designed specifically for embedded Linux routers running OpenWrt 22.03+ / 23.05+ with native `nftables` (`fw4`) and `ubus`.
2. **Zero Bloat (Standard Library Only)**: Uses only built-in Python 3 modules (`json`, `subprocess`, `re`, `logging`, `pathlib`, `argparse`, `datetime`). Fits on resource-constrained flash memory (16MB+).
3. **Modular & Decoupled**: Network access control (`nftables`), bandwidth accounting (`nlbwmon`), and configuration are strictly separated into independent modules.
4. **Hardened Security**:
   - Strict MAC address format validation (`XX:XX:XX:XX:XX:XX`).
   - Safe process execution (`subprocess.run` with list arguments, `shell=False`) to prevent command injection.
   - Read-only operations for querying; atomic updates for blocking/unblocking.
5. **Auditable Logging**: Standardized log format (`[INFO]`, `[WARNING]`, `[ERROR]`) compatible with console output, syslog, and `logread`.

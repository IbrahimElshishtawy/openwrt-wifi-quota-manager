# OpenWrt Wi-Fi Quota Manager — System Architecture

This document describes the high-level architecture, module responsibilities, and data flow of the OpenWrt router subsystem.

---

## 🏛 Component Hierarchy

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        OpenWrt Router Firmware                         │
│                                                                        │
│  ┌────────────────────────┐                 ┌───────────────────────┐  │
│  │     Kernel Network     │                 │   dnsmasq (DHCP/DNS)  │  │
│  │        Counters        │                 │  (/tmp/dhcp.leases)   │  │
│  └───────────┬────────────┘                 └───────────┬───────────┘  │
│              │                                          │              │
│              ▼                                          ▼              │
│  ┌────────────────────────┐                 ┌───────────────────────┐  │
│  │        nlbwmon         │                 │    Device Manager     │  │
│  │ (Bandwidth Accounting) │                 │   (Config & Lease)    │  │
│  └───────────┬────────────┘                 └───────────┬───────────┘  │
│              │ (ubus IPC)                               │              │
│              ▼                                          │              │
│  ┌────────────────────────┐                             │              │
│  │     Usage Manager      │                             │              │
│  │ (Bytes -> GB Parser)   │                             │              │
│  └───────────┬────────────┘                             │              │
│              │                                          │              │
│              └──────────────────┬───────────────────────┘              │
│                                 ▼                                      │
│                     ┌───────────────────────┐                          │
│                     │     Quota Manager     │                          │
│                     │  (Core Policy Engine) │                          │
│                     │ (Warning Deduplicator)│                          │
│                     └───────────┬───────────┘                          │
│                                 │                                      │
│                                 ▼                                      │
│                     ┌───────────────────────┐                          │
│                     │   nftables Layer      │                          │
│                     │ (set blocked_devices) │                          │
│                     └───────────┬───────────┘                          │
│                                 │                                      │
│                                 ▼                                      │
│                     ┌───────────────────────┐                          │
│                     │ Internet Access Gate  │                          │
│                     │ (Drop Transit Packet) │                          │
│                     └───────────────────────┘                          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      REST HTTP API Server                        │  │
│  │     (Port 8080 - Bridge for Flutter Mobile Dashboard / LAN)      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Component Responsibilities

| Component | File / Service | Primary Responsibility | Isolation Boundary |
| :--- | :--- | :--- | :--- |
| **nlbwmon** | OpenWrt Daemon | Passive in-kernel netfilter bandwidth accounting per MAC and IP. | Kernel space & ubus service. |
| **Usage Manager** | `usage_manager.py` | Queries `ubus call nlbwmon query`, parses JSON output, and aggregates upload/download bytes per normalized MAC address. | Does NOT know about quota limits or firewall rules. |
| **Device Manager** | `device_manager.py` | Loads static configuration (`devices.json`) and inspects live ARP / DHCP tables (`/tmp/dhcp.leases`). Performs atomic file updates. | Does NOT modify firewall or track bandwidth. |
| **Quota Manager** | `check_quota.py` | Core engine. Evaluates `Usage` vs `Quota Limit` per device. Tracks warning thresholds (80%, 90%, 95%, 100%). | Pure decision logic orchestrating managers and firewall drivers. |
| **nftables Layer** | `rules.nft` | High-speed kernel packet filter. Holds `blocked_devices` set ($O(1)$ lookup) hooked into `forward` chain (priority -5). | Operates purely on packet MAC addresses without high-level context. |
| **REST HTTP API** | `api_usage.py` | Exposes REST endpoints on port 8080 for the Flutter mobile application and local administrators. | Standard HTTP server without external dependencies. |
| **Cron Subsystem** | `/etc/crontabs/root` | Drives periodic execution (every 1 minute) of `check_quota.py`. | Scheduling only. |
| **Service Subsystem**| `quota-manager.init` | Manages process lifecycle using OpenWrt `procd`. Ensures automatic restart of the API daemon and boot initialization. | OS supervisor integration. |

---

## 🛡 Firewall Safety Architecture

To prevent accidental administrator lockout:
1. **Forward Chain Only**: The rule is strictly hooked into `type filter hook forward priority -5;`.
2. **Transit Traffic vs Host Traffic**: Packets traversing the router to the WAN/Internet hit the `forward` chain and are dropped if the MAC is in `blocked_devices`.
3. **Router Management Unaffected**: Packets from the LAN client to the router itself (e.g. `192.168.1.1:80` for LuCI, `192.168.1.1:22` for SSH, `192.168.1.1:53` for DNS, `192.168.1.1:8080` for the API) traverse the `input` chain and are **NEVER** dropped by this table.

---

## 💾 Memory & Storage Strategy for OpenWrt

- **Persistent Flash Overlay (`/etc/`, `/root/`)**: Stores immutable scripts, services, and configuration (`devices.json`).
- **Volatile RAM (`/tmp/`, `/var/log/`)**: All logs (`/var/log/quota_manager.log`), warning states (`/tmp/quota_warning_state.json`), and temporary caches reside in `tmpfs` (RAM). This prevents write wear on router flash memory chips.
- **Standard Library Only**: No external Python dependencies (`requests`, `flask`, `numpy`, etc.) are installed, keeping disk usage under 1 MB.

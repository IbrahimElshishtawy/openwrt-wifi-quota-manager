# OpenWrt Wi-Fi Quota Manager - System Architecture

This document describes the high-level architecture, module responsibilities, and data flow of the OpenWrt layer.

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
│                     │   (Allow vs Drop)     │                          │
│                     └───────────────────────┘                          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         API Subsystem                            │  │
│  │    (Future Bridge for Flutter Mobile Dashboard via Local LAN)    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Component Responsibilities

| Component | File / Service | Primary Responsibility | Isolation Boundary |
| :--- | :--- | :--- | :--- |
| **nlbwmon** | OpenWrt Daemon | Passive in-kernel netfilter bandwidth accounting per MAC and IP. | Kernel space & ubus service. |
| **Usage Manager** | `usage_manager.py` | Queries `ubus call nlbwmon query`, parses JSON output, and aggregates upload/download bytes per normalized MAC address. | Does NOT know about quota limits or firewall rules. |
| **Device Manager** | `device_manager.py` | Loads static configuration (`devices.json`) and inspects live ARP / DHCP tables (`/tmp/dhcp.leases`). Validates MAC syntax. | Does NOT modify firewall or track bandwidth. |
| **Quota Manager** | `check_quota.py` | Core engine. Evaluates `Usage` vs `Quota Limit` per device. Decides allow/block actions. | Pure decision logic orchestrating managers and firewall drivers. |
| **nftables Layer** | `rules.nft` | High-speed kernel packet filter. Holds `blocked_devices` set ($O(1)$ lookup) hooked into `forward` chain (priority -5). | Operates purely on packet MAC addresses without high-level context. |
| **Cron Subsystem** | `/etc/crontabs/root` | Drives periodic execution (e.g. every 1 minute) of `check_quota.py`. | Scheduling only. |
| **Service Subsystem**| `quota-manager.init` | Manages process lifecycle using OpenWrt `procd`. Ensures automatic restart and boot execution. | OS supervisor integration. |
| **API (Future)** | `openwrt/api/` | Local REST endpoint for mobile Flutter client to query metrics and adjust quotas. | Exposes network interface without touching kernel internals directly. |

---

## 💾 Memory & Storage Strategy for OpenWrt

OpenWrt routers feature constrained hardware profiles:
- **Persistent Overlay (`/root/` or `/etc/`)**: Used exclusively for static code, service definitions, and the `devices.json` configuration file.
- **Volatile RAM (`/tmp/` / `tmpfs`)**: Used for logs (`/var/log/`), DHCP leases (`/tmp/dhcp.leases`), and runtime databases (`/tmp/nlbwmon.db`). This guarantees zero Flash memory endurance wear.
- **Python Standard Library Only**: No external runtime dependencies (`pip`, `requests`, `numpy`, etc.) are installed on the router, fitting easily within standard OpenWrt images.

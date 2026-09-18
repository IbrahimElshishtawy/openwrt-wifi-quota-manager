# nftables Access Control Layer (`openwrt/nftables/`)

This directory contains the packet filtering configuration for the OpenWrt Wi-Fi Quota Manager. It isolates network access enforcement from the quota evaluation logic using high-performance `nftables` sets.

---

## 🛡 Design Overview

Instead of adding individual `iptables` / `nftables` drop rules for every client (which degrades performance linearly), this design uses an **`nftables` set** named `blocked_devices` with type `ether_addr`.

- **Set Lookup Performance**: $O(1)$ constant time lookup in the kernel, regardless of whether 1 or 50 devices are blocked.
- **Atomic Operations**: Elements can be added or deleted at runtime without reloading firewall tables or breaking existing connection states for other clients.
- **Hook Priority (-5)**: Sits in the `forward` chain at priority `-5`, discarding packets before NAT processing to preserve router CPU cycles.

---

## 📜 Loading Rules into OpenWrt

To initialize the `quota_manager` table:

```bash
# Load rules directly from file
nft -f /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft

# Verify table and set creation
nft list table inet quota_manager
```

### Persistence on OpenWrt Boot

To persist the rules across reboots on OpenWrt 22.03+ / 23.05+ (`fw4`):

```bash
# Copy or symlink rules.nft into /etc/nftables.d/
cp /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft /etc/nftables.d/99-quota-manager.nft
```

OpenWrt's `fw4` automatically includes any files in `/etc/nftables.d/*.nft` during firewall reload or boot.

---

## ⚡ Runtime CLI Commands

The Python scripts interact with this table via the `nft` binary. You can also run these commands manually:

### 1. Block a Device (Add MAC to set)
```bash
nft add element inet quota_manager blocked_devices { AA:BB:CC:DD:EE:FF }
```

### 2. Unblock a Device (Delete MAC from set)
```bash
nft delete element inet quota_manager blocked_devices { AA:BB:CC:DD:EE:FF }
```

### 3. List All Currently Blocked Devices
```bash
nft list set inet quota_manager blocked_devices
```

### 4. Check If a Specific MAC is Blocked
```bash
nft get element inet quota_manager blocked_devices { AA:BB:CC:DD:EE:FF }
```

### 5. Flush All Blocked Devices (Emergency Reset)
```bash
nft flush set inet quota_manager blocked_devices
```

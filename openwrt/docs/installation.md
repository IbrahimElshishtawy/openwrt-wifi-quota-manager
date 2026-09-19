# OpenWrt Wi-Fi Quota Manager — Installation Manual

This guide provides step-by-step instructions for deploying, installing, and configuring the OpenWrt Wi-Fi Quota Manager on an OpenWrt router.

---

## 📋 System Requirements & Prerequisites

| Requirement | Minimum Specification | Recommended |
| :--- | :--- | :--- |
| **OpenWrt Firmware** | Version 22.03+ (using `fw4` / `nftables`) | Version 23.05+ |
| **Target Architecture** | Any (`mips`, `mipsel`, `arm`, `aarch64`, `x86_64`) | `arm_cortex-a53` / `x86_64` |
| **Free Flash Storage** | 8 MB | 16 MB+ |
| **Free RAM** | 16 MB | 32 MB+ |
| **Required Packages** | `python3-base`, `nlbwmon`, `nftables` | Included in standard package repositories |

---

## 🚀 Installation Methods

### Method A: Automated Remote Deployment (`deploy.sh`)

From your Linux/macOS development machine on the same local network:

```bash
# Push directly to router (defaults to 192.168.1.1, port 22, user root)
./openwrt/deploy.sh 192.168.1.1
```

If your router uses a non-standard SSH port or custom IP:
```bash
./openwrt/deploy.sh 192.168.8.1 2222 root
```

After the files are uploaded, SSH into the router and execute the installer:
```bash
ssh root@192.168.1.1 '/root/openwrt-wifi-quota-manager/openwrt/install.sh'
```

---

### Method B: Manual On-Router Installation (`install.sh`)

1. **SSH into the OpenWrt Router**:
   ```bash
   ssh root@192.168.1.1
   ```

2. **Navigate to the Project Directory**:
   ```bash
   cd /root/openwrt-wifi-quota-manager/openwrt
   ```

3. **Run the Automated Installer**:
   ```bash
   sh install.sh
   ```

The script automatically executes the following configuration steps:

#### 1. Package Dependency Verification
```bash
opkg update
opkg install python3-base nlbwmon nftables
```

#### 2. Service Permissions
```bash
chmod +x scripts/*.py api/*.py services/*.init tests/*.sh
```

#### 3. nlbwmon Daemon Configuration & Startup
```bash
/etc/init.d/nlbwmon enable
/etc/init.d/nlbwmon restart
```

#### 4. nftables Ruleset Installation
Copies `rules.nft` into OpenWrt's native firewall directory `/etc/nftables.d/` so rules load automatically on boot and firewall reloads:
```bash
mkdir -p /etc/nftables.d
cp nftables/rules.nft /etc/nftables.d/99-quota-manager.nft
nft -f /etc/nftables.d/99-quota-manager.nft
```

#### 5. procd Service Installation
Installs `/etc/init.d/quota-manager`, enabling continuous supervision of the background REST API daemon:
```bash
/etc/init.d/quota-manager enable
/etc/init.d/quota-manager start
```

#### 6. Periodic Cron Job Registration
Appends the 1-minute quota audit schedule to `/etc/crontabs/root`:
```bash
* * * * * /usr/bin/python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py >> /var/log/quota_manager.log 2>&1
/etc/init.d/cron enable
/etc/init.d/cron restart
```

#### 7. Verification Audit
Runs `tests/verify_openwrt.sh` to confirm operational readiness.

---

## 🔍 Post-Installation Verification

### 1. Verify nftables Table and Set
```bash
nft list table inet quota_manager
```
Expected output:
```text
table inet quota_manager {
    set blocked_devices {
        type ether_addr
    }
    chain forward_quota {
        type filter hook forward priority raw - 5; policy accept;
        ether saddr @blocked_devices counter packets 0 bytes 0 drop
        ether daddr @blocked_devices counter packets 0 bytes 0 drop
    }
}
```

### 2. Verify nlbwmon Daemon
```bash
ubus call nlbwmon query
```
Expected output: Valid JSON containing traffic columns or records.

### 3. Verify REST API Server
```bash
curl http://127.0.0.1:8080/health
```
Expected output:
```json
{
  "status": "ok",
  "service": "OpenWrt Wi-Fi Quota Manager API",
  "version": "1.0.0"
}
```

### 4. Verify Real-Time Quota Status Table
```bash
python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py --status
```

---

## 🗑 Uninstallation / Safe Removal

To cleanly remove the subsystem without affecting router network settings:

```bash
sh /root/openwrt-wifi-quota-manager/openwrt/uninstall.sh
```

This:
1. Stops and disables the `quota-manager` service.
2. Flushes and removes the `inet quota_manager` nftables table.
3. Removes the scheduled job from `/etc/crontabs/root`.
4. Removes temporary warning state files in `/tmp/`.
5. Leaves unrelated router network, firewall, and Wi-Fi configurations completely intact.

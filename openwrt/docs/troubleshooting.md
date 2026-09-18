# Troubleshooting Guide (`openwrt/docs/troubleshooting.md`)

This guide addresses common operational, network, and system issues encountered when deploying the Quota Manager on OpenWrt routers.

---

## 🔍 Diagnostic Matrix

| Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| **`nlbwmon` returns empty or error** | Daemon not running or interface misconfigured | Restart `nlbwmon` and inspect `/etc/config/nlbwmon` |
| **Randomized MAC addresses** | Modern smartphones (iOS/Android) use Private Wi-Fi MACs | Disable "Private Wi-Fi Address" on client device for the home network |
| **Device not blocked by nftables** | Table `quota_manager` not loaded or wrong set name | Re-load `rules.nft` and check `nft list table inet quota_manager` |
| **Cron jobs not executing** | BusyBox `crond` service disabled or inactive | Run `/etc/init.d/cron enable && /etc/init.d/cron start` |
| **Script execution permissions denied** | Missing executable bit (`+x`) | Run `chmod +x openwrt/scripts/*.py` |
| **State lost after router reboot** | Config saved in `/tmp/` instead of persistent storage | Store `devices.json` in `/root/` or `/etc/config/` |
| **Python command not found** | Python 3 not installed in OpenWrt firmware | Run `opkg update && opkg install python3-base python3-light` |

---

## 🛠 Detailed Troubleshooting Steps

### 1. `nlbwmon` Issues

#### Symptom: `ubus call nlbwmon query` returns `Failed to connect to ubus` or empty rows
- **Step 1: Check daemon status:**
  ```bash
  /etc/init.d/nlbwmon status
  ps | grep nlbwmon
  ```
- **Step 2: Start or restart nlbwmon:**
  ```bash
  /etc/init.d/nlbwmon restart
  ```
- **Step 3: Verify listening interfaces in `/etc/config/nlbwmon`:**
  Ensure the local LAN bridge (`br-lan`) is set in `/etc/config/nlbwmon`:
  ```uci
  config nlbwmon
      list local_network '192.168.1.0/24'
  ```
- **Step 4: Commit and query again:**
  ```bash
  ubus call nlbwmon query
  ```

---

### 2. Client MAC & Randomized Address Issues

#### Symptom: A device changes its MAC address dynamically
- Modern mobile operating systems (iOS 14+, Android 10+, Windows 11) randomize MAC addresses by default per Wi-Fi network.
- **Remediation**:
  1. On the user's phone, open Wi-Fi settings for the router's SSID.
  2. Set **MAC Address Type** / **Private Wi-Fi Address** to **Device MAC** (Phone MAC).
  3. Ensure the static MAC address is registered in `openwrt/config/devices.json`.

---

### 3. `nftables` Rule Issues

#### Symptom: `check_quota.py` adds MAC to `blocked_devices`, but client can still access internet
- **Step 1: Verify the table exists:**
  ```bash
  nft list table inet quota_manager
  ```
- **Step 2: Inspect elements currently in the set:**
  ```bash
  nft list set inet quota_manager blocked_devices
  ```
- **Step 3: Check packet and byte counters:**
  ```bash
  nft list chain inet quota_manager forward_quota
  ```
  If packet counters are `0 packets`, verify that the router is actually routing client traffic across the `forward` chain (e.g. ensure client is passing through LAN to WAN and hardware offloading/flow offloading is not bypassing netfilter hooks).
  *Note:* If OpenWrt Software/Hardware Flow Offloading (`kmod-ipt-offload` / `nft-offload`) is enabled, initial connections are inspected, but high-throughput streams might bypass forward filters. If packets bypass the filter, disable flow offloading in LuCI (**Network → Firewall → Routing/Flow Offloading**).

---

### 4. Cron Execution Issues

#### Symptom: Logs are not updating in `/var/log/quota_manager.log`
- **Step 1: Check cron service status:**
  ```bash
  /etc/init.d/cron status
  ```
- **Step 2: Inspect `/etc/crontabs/root`:**
  ```bash
  cat /etc/crontabs/root
  ```
  Ensure the line is properly formatted with absolute paths:
  ```crontab
  * * * * * /usr/bin/python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py >> /var/log/quota_manager.log 2>&1
  ```
- **Step 3: Test running the command directly in shell:**
  ```bash
  /usr/bin/python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py --verbose
  ```

---

### 5. Router Reboot & Persistence

#### Symptom: Rules or blocked sets disappear after router power cycle
- OpenWrt stores volatile files in `/tmp/` (`tmpfs` in RAM).
- To make firewall rules persist across boots:
  ```bash
  cp /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft /etc/nftables.d/99-quota-manager.nft
  ```
- Make sure `devices.json` is stored on the root overlay filesystem (e.g., `/root/` or `/etc/config/`), NOT inside `/tmp/`.
- During boot, when `cron` triggers `check_quota.py` for the first time, all devices exceeding quota will be re-added to the `blocked_devices` set automatically.

# Troubleshooting & Diagnostics Guide

This document provides resolutions for common issues encountered during deployment, runtime execution, and firewall enforcement on OpenWrt routers.

---

## 🚨 Common Scenarios & Remediation

### 1. `Command 'ubus' not found` or `nlbwmon unavailable`
- **Symptom**: `usage_manager.py` logs `Command 'ubus' not found` or returns 0 bytes for all devices.
- **Cause**: Running on a non-OpenWrt host (e.g. desktop Linux) or `nlbwmon` daemon is not started.
- **Fix**:
  1. On an OpenWrt router, check the service status:
     ```bash
     /etc/init.d/nlbwmon status
     ```
  2. If inactive, start and enable it:
     ```bash
     /etc/init.d/nlbwmon enable
     /etc/init.d/nlbwmon start
     ```
  3. Verify `ubus` registration:
     ```bash
     ubus list | grep nlbwmon
     ubus call nlbwmon query
     ```

---

### 2. `netlink: Error: cache initialization failed: Operation not permitted`
- **Symptom**: Running `nft` or `rules.nft` produces an operation not permitted error.
- **Cause**: The command is being executed as an unprivileged user on Linux without `CAP_NET_ADMIN`.
- **Fix**: On OpenWrt routers, scripts execute as `root`. Run the command as `root` (or with `sudo` if configured):
  ```bash
  nft -c -f /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft
  ```

---

### 3. Blocked Device Still Has Internet Access
- **Symptom**: Device MAC is present in `nft list set inet quota_manager blocked_devices`, but client can still load web pages.
- **Causes & Fixes**:
  1. **MAC Randomization**: Modern mobile devices (iOS Private Wi-Fi Address, Android MAC Randomization) may change their MAC address.
     - *Fix*: Instruct users to disable Private / Randomized MAC for the home network SSID, or configure the quota against their current active randomized address.
  2. **Existing Established Connections (Conntrack)**: Existing TCP streams established prior to the block may persist briefly until packets are evaluated.
     - *Fix*: The rules in `rules.nft` hook at priority `-5` (before standard conntrack NAT), so new packets are dropped immediately. To terminate existing connection tracks immediately:
       ```bash
       conntrack -F 2>/dev/null || true
       ```
  3. **IPv6 Bypass**: Client traffic may be bypassing IPv4 rules via IPv6.
     - *Fix*: The table `table inet quota_manager` operates on the `inet` family, covering both IPv4 and IPv6 traffic simultaneously. Ensure the client's hardware MAC matches.

---

### 4. Administrator Locked Out of Router
- **Symptom**: Administrator is worried that adding rules will lock them out of LuCI / SSH.
- **Explanation**: The access control chain `forward_quota` only intercepts forwarded traffic (client to WAN). It does not intercept input traffic to the router (`192.168.1.1:80` or `192.168.1.1:22`).
- **Emergency Recovery**:
  If needed, SSH into the router from an unblocked client and flush the table:
  ```bash
  nft delete table inet quota_manager
  ```

---

### 5. Cron Not Running Quota Checks
- **Symptom**: No updates in `/var/log/quota_manager.log` after 1 minute.
- **Fix**:
  1. Verify the cron daemon is running:
     ```bash
     /etc/init.d/cron status
     ```
  2. If stopped, start it:
     ```bash
     /etc/init.d/cron enable
     /etc/init.d/cron start
     ```
  3. Check the crontab file:
     ```bash
     cat /etc/crontabs/root
     ```

---

### 6. API Server Not Responding on Port 8080
- **Symptom**: `curl http://192.168.1.1:8080/health` times out or refuses connection.
- **Fix**:
  1. Check if the process is running:
     ```bash
     ps | grep api_usage.py
     ```
  2. Check procd service status:
     ```bash
     /etc/init.d/quota-manager status
     /etc/init.d/quota-manager restart
     ```
  3. View service logs:
     ```bash
     logread -e quota-manager
     ```
  4. Ensure the router firewall allows incoming traffic on port 8080 from the `lan` zone.

---

### 7. JSON Configuration Corruption
- **Symptom**: `devices.json` was edited manually and contains syntax errors.
- **Fix**:
  Validate syntax:
  ```bash
  python3 -m json.tool /root/openwrt-wifi-quota-manager/openwrt/config/devices.json
  ```
  DeviceManager uses atomic writes with `.tmp` files to prevent corrupted writes on power cut.

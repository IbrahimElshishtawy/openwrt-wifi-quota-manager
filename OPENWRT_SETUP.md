# OpenWrt Router Configuration & Setup Guide

This guide provides step-by-step instructions to configure your OpenWrt router to communicate with the **Wi-Fi Quota Manager** Flutter mobile application.

---

## 📋 1. Requirements Overview

| Component | Minimum Version | Purpose |
| :--- | :--- | :--- |
| **OpenWrt Firmware** | 22.03+ / 23.05+ | Base router operating system (`nftables` / `fw4` support) |
| **Python** | `python3-base` 3.9+ | Executes lightweight REST API daemon (`api_usage.py`) |
| **Traffic Monitor** | `nlbwmon` | Low-overhead kernel netlink bandwidth monitoring |
| **Firewall** | `nftables` (`fw4`) | Hardware-level packet dropping and MAC filtering |
| **Init Service** | `procd` | OpenWrt service supervisor keeping the API daemon alive |
| **Cron** | `busybox-cron` | Periodic quota enforcement & billing cycle audit |

---

## 📦 2. Installing Required Router Packages

SSH into your OpenWrt router:

```bash
ssh root@192.168.1.1
```

Update package lists and install dependencies:

```bash
opkg update
opkg install python3-base nlbwmon nftables
```

*Note: For routers with limited flash storage (e.g. 16MB), `python3-base` requires only ~4MB and avoids unnecessary heavy libraries.*

---

## 📊 3. Traffic Accounting Setup (`nlbwmon`)

`nlbwmon` collects per-host and per-subnet traffic data using kernel netlink sockets without taxing the CPU:

1. Enable and configure `nlbwmon`:
   ```bash
   uci set nlbwmon.default=nlbwmon
   uci set nlbwmon.default.commit_interval='24h'
   uci set nlbwmon.default.refresh_interval='10s'
   uci commit nlbwmon
   ```

2. Enable the service and start it:
   ```bash
   /etc/init.d/nlbwmon enable
   /etc/init.d/nlbwmon restart
   ```

3. Verify traffic collection:
   ```bash
   nlbw -c json
   ```

---

## 🛡️ 4. Firewall Access Control (`nftables`)

The subsystem uses a dedicated `inet quota_manager` table. This prevents any interference with standard OpenWrt firewall (`fw4`) rules or router management access.

1. Create or verify table initialization in `/etc/nftables.d/quota_manager.nft` (or load via init script):
   ```nft
   table inet quota_manager {
       set blocked_devices {
           type ether_addr
           flags interval
       }

       chain forward_filter {
           type filter hook forward priority -10; policy accept;
           ether saddr @blocked_devices drop
           ether daddr @blocked_devices drop
       }
   }
   ```

2. Load the rules into the live kernel:
   ```bash
   nft -f /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft
   ```

3. Verify the blocked devices set:
   ```bash
   nft list set inet quota_manager blocked_devices
   ```

> [!NOTE]
> Management traffic (SSH on port 22, LuCI on port 80/443, DNS on port 53, DHCP on port 67/68) passes through the `input` chain and is **never** blocked, ensuring you will never be locked out of router administration.

---

## 🌐 5. Deploying the Router API Daemon

The repository includes a 1-command deployment script to copy and activate the subsystem:

### Option A: From your computer using `deploy.sh`
```bash
./openwrt/deploy.sh 192.168.1.1
```

### Option B: Manual Installation on Router
```bash
# Clone or copy openwrt/ folder to /root/openwrt-wifi-quota-manager/openwrt
cd /root/openwrt-wifi-quota-manager/openwrt
sh install.sh
```

The installer:
- Links `/etc/init.d/quota-manager`
- Enables auto-start on boot: `/etc/init.d/quota-manager enable`
- Launches the daemon on port `8080`: `/etc/init.d/quota-manager start`
- Configures cron in `/etc/crontabs/root` to audit quotas every minute

---

## 🔑 6. Authentication Setup

### Pre-Shared API Bearer Token
To enforce bearer token authentication on the REST API, configure the init script or launch parameters:

```bash
# In /etc/init.d/quota-manager or environment variable:
export QUOTA_API_KEY="my-secure-router-token-2026"
```

The Flutter app will transmit this token securely in the `Authorization: Bearer <TOKEN>` header.

### LuCI RPC Authentication
If using standard LuCI endpoints instead of the REST daemon:
1. Ensure `luci-mod-rpc` is installed: `opkg install luci-mod-rpc`
2. The Flutter client authenticates against `/cgi-bin/luci/rpc/auth` with the router's `root` credentials and automatically manages the `sysauth` cookie.

---

## 🔍 7. Obtaining Router IP & Verifying Connectivity

### Finding Router Gateway IP
- **Android / iOS**: Go to Wi-Fi settings → Select connected network → View Gateway / Router IP (usually `192.168.1.1` or `192.168.0.1`).
- **Computer**:
  - Linux / macOS: `ip route show default` or `route -n get default`
  - Windows: `ipconfig | findstr "Default Gateway"`

### Testing Local Connectivity
From a device on the Wi-Fi network:

```bash
# Test health endpoint:
curl -i http://192.168.1.1:8080/health

# Test device list:
curl -i -H "Authorization: Bearer openwrt-secret-token-2026" http://192.168.1.1:8080/devices
```

Expected response from `/health`:
```json
{
  "status": "ok",
  "service": "OpenWrt Wi-Fi Quota Manager API",
  "version": "1.0.0",
  "timestamp": "2026-09-20T01:00:00.000000"
}
```

---

## 📱 8. Configuring the Flutter Mobile App

1. Open **Wi-Fi Quota Manager** on your phone.
2. Tap the **Settings** icon (top-right or bottom navigation bar).
3. Under **OpenWrt Connection Configuration**:
   - **Protocol**: Choose `HTTP` (or `HTTPS` if you installed SSL certs on the router).
   - **Router IP**: Enter your router IP (e.g. `192.168.1.1`).
   - **Port**: `8080` (or `80` for LuCI).
   - **Username**: `root` (or custom user).
   - **Password**: Router administrator password.
   - **API Pre-Shared Bearer Token**: Enter the token matching `QUOTA_API_KEY`.
4. Switch off **Demo Mode** to activate live communication.
5. Tap **Test Connection**:
   - Verify green confirmation: *"Connected successfully to OpenWrt Router!"*
6. Tap **Save Settings**.
7. Return to the **Dashboard** — live bandwidth, active devices, and quota consumption will sync automatically.

---

## ⚠️ 9. Security Best Practices

> [!CAUTION]
> **LAN-Only Exposure**: Never expose port 8080 or LuCI port 80 directly to the WAN interface. Keep firewall input rules restricted to the LAN zone (`br-lan`).

1. **Avoid WAN Forwarding**: Ensure port 8080 is accessible only from internal private subnets (`192.168.0.0/16`, `10.0.0.0/8`).
2. **Encrypted Storage**: The Flutter client stores router credentials using encrypted obfuscation.
3. **Log Sanitization**: Passwords, authorization tokens, and session cookies are scrubbed and never output to debug logs.

---

## 🛠️ 10. Troubleshooting & Common Issues

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| **"Router Unreachable"** | Phone on cellular network or wrong IP | Connect phone to router Wi-Fi. Verify router IP matches gateway address. |
| **"Connection Timed Out"** | API daemon not running on port 8080 | Run `/etc/init.d/quota-manager status`. Restart with `/etc/init.d/quota-manager restart`. |
| **"Authentication Failed"** | Incorrect API token or password | Check token in router `/etc/init.d/quota-manager` and re-enter in app Settings. |
| **"Usage data empty (0 GB)"** | `nlbwmon` daemon not collecting | Run `nlbw -c json` on router. If empty, restart `nlbwmon`: `/etc/init.d/nlbwmon restart`. |
| **"Devices not blocked"** | Missing `inet quota_manager` table | Reload nftables: `nft -f /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft`. |
| **Android HTTP Error** | Cleartext blocked by OS | Local private subnets are permitted via `network_security_config.xml`. Ensure phone is on local Wi-Fi. |

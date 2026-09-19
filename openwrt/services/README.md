# Service Subsystem (`openwrt/services/`)

This directory provides the OpenWrt `procd` init script (`quota-manager.init`) that integrates the subsystem with OpenWrt's native service supervisor.

---

## 🛠 Responsibilities

1. **Firewall Initialization**: Ensures the `inet quota_manager` table and `blocked_devices` set are loaded into `nftables` prior to starting the API daemon.
2. **Persistent API Daemon**: Supervised execution of `api_usage.py` on port 8080 with automatic restart if killed (`respawn 3600 5 0`).
3. **Boot Autostart**: Starts automatically at boot priority `START=95` (after networking and firewall are active).
4. **Clean Shutdown**: Graceful termination at `STOP=10`.

---

## 🎮 Service Commands

On the OpenWrt router:

```bash
# Check service status
/etc/init.d/quota-manager status

# Start service
/etc/init.d/quota-manager start

# Stop service
/etc/init.d/quota-manager stop

# Restart service
/etc/init.d/quota-manager restart

# Reload configuration and trigger immediate quota audit
/etc/init.d/quota-manager reload

# Enable service at system startup
/etc/init.d/quota-manager enable

# Disable service
/etc/init.d/quota-manager disable
```

---

## 🔍 Log Monitoring

Check service events via OpenWrt's system logger:
```bash
logread -e quota-manager
```

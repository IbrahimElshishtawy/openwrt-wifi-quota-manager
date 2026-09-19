# REST HTTP API Subsystem (`openwrt/api/`)

The REST HTTP API server (`api_usage.py`) provides the bridge between the OpenWrt router's kernel quota subsystem and client applications (such as the Flutter mobile dashboard and administrative tools).

---

## 🌐 Overview & Architecture

- **Zero Third-Party Dependencies**: Built exclusively with Python's standard `http.server` module. Does not require Flask, FastAPI, or uwsgi, conserving flash memory and RAM on embedded routers.
- **Persistent Daemon**: Supervised by OpenWrt's `procd` init system (`/etc/init.d/quota-manager`), automatically restarting if terminated and booting at system startup.
- **LAN Security**: Binds to internal interfaces (`0.0.0.0:8080` or `192.168.1.1:8080`). Rejects WAN access by default.
- **CORS Support**: Emits standard CORS headers (`Access-Control-Allow-Origin: *`) allowing direct fetch calls from the Flutter application.
- **Optional Bearer Token Authentication**: Pass `--api-key <KEY>` or set `QUOTA_API_KEY` to enforce `Authorization: Bearer <KEY>`.

---

## 🚀 Running the API Server

### Manual CLI Execution
```bash
# Start on default port 8080:
python3 /root/openwrt-wifi-quota-manager/openwrt/api/api_usage.py --port 8080

# Run in dry-run mode (no firewall changes):
python3 /root/openwrt-wifi-quota-manager/openwrt/api/api_usage.py --port 8080 --dry-run

# Run with optional API Bearer key:
python3 /root/openwrt-wifi-quota-manager/openwrt/api/api_usage.py --port 8080 --api-key mysecretkey
```

### Procd Service Control
```bash
/etc/init.d/quota-manager start
/etc/init.d/quota-manager stop
/etc/init.d/quota-manager restart
/etc/init.d/quota-manager status
```

---

## 📡 API Endpoints Reference

### 1. `GET /health`
Returns service status, uptime, and API version.
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "OpenWrt Wi-Fi Quota Manager API",
    "version": "1.0.0",
    "timestamp": "2026-09-19T03:46:42.191554"
  }
  ```

---

### 2. `GET /devices`
Returns all registered devices enriched with current bandwidth usage, quota allowance, percentage, remaining bandwidth, and active lease information (IP and hostname).
- **Response**:
  ```json
  {
    "status": "success",
    "count": 2,
    "devices": [
      {
        "mac": "AA:BB:CC:DD:EE:FF",
        "name": "Ahmed Phone",
        "ip": "192.168.1.100",
        "hostname": "Ahmed-iPhone",
        "quota_gb": 20.0,
        "usage_gb": 12.5,
        "download_gb": 10.0,
        "upload_gb": 2.5,
        "remaining_gb": 7.5,
        "usage_percentage": 62.5,
        "enabled": true,
        "status": "allowed",
        "is_blocked": false,
        "formatted_usage": "12.50 GB"
      }
    ]
  }
  ```

---

### 3. `POST /quota`
Updates quota limit or toggles administrative state for a specific device.
- **Request Body**:
  ```json
  {
    "mac": "AA:BB:CC:DD:EE:FF",
    "quota_gb": 25.0,
    "enabled": true
  }
  ```
- **Response**:
  ```json
  {
    "status": "success",
    "message": "Quota updated successfully",
    "device": {
      "mac": "AA:BB:CC:DD:EE:FF",
      "name": "Ahmed Phone",
      "quota_gb": 25.0,
      "enabled": true
    }
  }
  ```

---

### 4. `POST /devices`
Registers a new device or updates an existing device configuration.
- **Request Body**:
  ```json
  {
    "mac": "44:55:66:77:88:99",
    "name": "Tablet",
    "quota_gb": 15.0,
    "enabled": true
  }
  ```

---

### 5. `DELETE /devices?mac=...`
Removes a device from the configuration and unblocks it from the firewall.
- **Query Parameter**: `mac=AA:BB:CC:DD:EE:FF`

---

### 6. `GET /reports`
Provides overall consumption statistics, subscription cycle status, and top consumer rankings.
- **Response**:
  ```json
  {
    "status": "success",
    "package": {
      "total_gb": 250.0,
      "start_date": "2026-09-01",
      "end_date": "2026-09-30"
    },
    "package_total_gb": 250.0,
    "package_remaining_gb": 155.5,
    "total_bandwidth_used_gb": 94.5,
    "cycle_days_remaining": 11,
    "top_consumers": [
      {
        "mac": "11:22:33:44:55:66",
        "name": "Living Room TV",
        "usage_bytes": 51539607552,
        "usage_gb": 48.0,
        "formatted": "48.00 GB"
      }
    ]
  }
  ```

---

### 7. `POST /package`
Updates ISP subscription parameters.
- **Request Body**:
  ```json
  {
    "total_gb": 300,
    "start_date": "2026-10-01",
    "end_date": "2026-10-31"
  }
  ```

---

### 8. `GET /usage`
Returns raw and aggregated live bandwidth counters directly from `nlbwmon`.

---

### 9. `GET /blocked`
Returns list of MAC addresses currently in the `inet quota_manager blocked_devices` nftables set.

---

### 10. `POST /block` & `POST /unblock`
Manually adds or removes a MAC from the firewall drop set.
- **Request Body**:
  ```json
  {
    "mac": "AA:BB:CC:DD:EE:FF"
  }
  ```

---

### 11. `POST /reset`
Initiates a billing period reset: clears warning threshold states and unblocks quota-blocked devices.

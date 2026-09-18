# API Subsystem Placeholder (`openwrt/api/`)

> [!NOTE]
> **MVP Phase Notice**: In accordance with the current milestone, this directory serves as the architectural specification and placeholder. The API implementation will be built after validating real-device `nlbwmon` and `nftables` performance.

---

## 🌐 Overview & Purpose

The future OpenWrt local API will act as the lightweight communication bridge between the router's quota system and client applications (such as the Flutter mobile app). It will expose REST endpoints over HTTP/HTTPS restricted to the local LAN.

---

## 📡 Planned API Specifications

### 1. `GET /devices`
- **Description**: Returns all configured devices, their current consumption metrics, quota limits, and live connection status (IP, hostname).
- **Response Format**:
  ```json
  {
    "status": "success",
    "devices": [
      {
        "mac": "AA:BB:CC:DD:EE:FF",
        "name": "Ahmed Phone",
        "ip": "192.168.1.150",
        "hostname": "Ahmed-iPhone",
        "usage_gb": 18.2,
        "quota_gb": 20.0,
        "remaining_gb": 1.8,
        "enabled": true,
        "is_blocked": false
      }
    ]
  }
  ```

### 2. `POST /quota`
- **Description**: Updates the assigned data quota limit or toggle state for a specific MAC address.
- **Request Body**:
  ```json
  {
    "mac": "AA:BB:CC:DD:EE:FF",
    "quota_gb": 25.0,
    "enabled": true
  }
  ```
- **Response Format**:
  ```json
  {
    "status": "success",
    "message": "Quota updated successfully",
    "mac": "AA:BB:CC:DD:EE:FF",
    "new_quota_gb": 25.0
  }
  ```

### 3. `GET /reports`
- **Description**: Retrieves bandwidth usage breakdown, historical totals, and top consumer rankings.
- **Response Format**:
  ```json
  {
    "status": "success",
    "total_bandwidth_used_gb": 94.5,
    "package_total_gb": 250.0,
    "package_remaining_gb": 155.5,
    "cycle_days_remaining": 12,
    "top_consumers": [
      {"mac": "11:22:33:44:55:66", "name": "Living Room TV", "usage_gb": 48.1}
    ]
  }
  ```

### 4. `POST /package`
- **Description**: Configures overall ISP subscription parameters (Total quota allowance and billing cycle renewal dates).
- **Request Body**:
  ```json
  {
    "total_gb": 300,
    "start_date": "2026-10-01",
    "end_date": "2026-10-31"
  }
  ```

---

## 🔒 Security Architecture

1. **Authentication**: All requests must supply a valid pre-shared API Key via the `Authorization: Bearer <API_KEY>` header.
2. **Local LAN Binding**: The daemon will bind strictly to internal router interfaces (`br-lan` / `192.168.1.1`) and reject WAN-facing traffic.
3. **Strict Validation**: All payloads will undergo schema validation (MAC regex, range checks) prior to modifying `devices.json` or invoking firewall changes.
4. **Lightweight Footprint**: Will be implemented using lightweight Python (`http.server` or `uwsgi`) to minimize RAM consumption on OpenWrt.

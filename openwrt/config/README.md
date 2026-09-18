# Configuration Management Subsystem (`openwrt/config/`)

This directory maintains the configuration data for internet subscription packages and individual device quotas.

---

## 📄 Schema Specification (`devices.json`)

The primary configuration file is `devices.json`, structured into two top-level blocks: `package` and `devices`.

```json
{
  "package": {
    "total_gb": 250,
    "start_date": "2026-09-01",
    "end_date": "2026-09-30"
  },
  "devices": [
    {
      "mac": "AA:BB:CC:DD:EE:FF",
      "name": "Ahmed Phone",
      "quota_gb": 20.0,
      "enabled": true
    }
  ]
}
```

### 1. `package` Object

Defines the overall ISP subscription parameters for the billing cycle.

| Field | Type | Required | Description | Validation Rule |
| :--- | :--- | :--- | :--- | :--- |
| `total_gb` | `number` | Yes | Total monthly data allowance in Gigabytes | Positive float/integer (> 0) |
| `start_date` | `string` | Yes | Billing cycle start date | ISO-8601 date format (`YYYY-MM-DD`) |
| `end_date` | `string` | Yes | Billing cycle end date | ISO-8601 date format (`YYYY-MM-DD`), >= `start_date` |

### 2. `devices` List

Contains policy definitions for each registered device.

| Field | Type | Required | Description | Validation Rule |
| :--- | :--- | :--- | :--- | :--- |
| `mac` | `string` | Yes | Hardware MAC address (Primary Key) | Case-insensitive regex: `^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$` (Normalized internally to uppercase with colons) |
| `name` | `string` | Yes | Human-readable alias (e.g. device owner) | 1-64 characters, safe printable characters |
| `quota_gb` | `number` | Yes | Maximum assigned data allowance in GB | Non-negative float/integer (>= 0) |
| `enabled` | `boolean` | Yes | Administrative toggle for internet access | `true` (Active), `false` (Immediately blocked) |

---

## 🔒 Security & Validation Guidelines

1. **MAC Address Normalization**: All MAC addresses read from configuration or user input are automatically normalized to uppercase hexadecimal pairs separated by colons (e.g., `aa:bb:cc:dd:ee:ff` -> `AA:BB:CC:DD:EE:FF`).
2. **Duplicate MACs**: Duplicate MAC entries in `devices.json` are treated as a configuration error and rejected to prevent ambiguous quota enforcement.
3. **Atomic Writes**: When updating `devices.json` via script or future API, write to a temporary file in the same directory (`devices.json.tmp`) and atomically rename (`os.replace`) to prevent corrupted reads during power cuts or concurrent access.
4. **Storage Persistence**: On OpenWrt, persistent configuration should reside within root overlay storage (`/etc/` or `/root/`). Volatile locations like `/tmp/` will lose state after a router reboot.

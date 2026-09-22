# OpenWrt Controller Backend

Fastify & TypeScript Backend Service for OpenWrt Router Management and Device Tracking.

## Architecture

```text
Fastify HTTP Request
       ↓
devices.routes.ts (GET /api/devices)
       ↓
DevicesController
       ↓
DevicesService
       ↓
UbusClient (JSON-RPC over Axios)
       ↓
OpenWrt Router (/ubus endpoint)
```

## Environment Variables

Copy `.env.example` to `.env` and configure router connection settings:

```env
# Server Configuration
HOST=0.0.0.0
PORT=3000
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=*

# OpenWrt Router Configuration
OPENWRT_HOST=192.168.50.1
OPENWRT_PORT=80
OPENWRT_USERNAME=root
OPENWRT_PASSWORD=CHANGE_ME
OPENWRT_USE_HTTPS=false
```

> **Security Note:** Never commit `.env` or router credentials to version control.

## Ubus Authentication & Session Management

1. `UbusClient` connects to OpenWrt's `http://<OPENWRT_HOST>:<PORT>/ubus` via Axios.
2. Performs JSON-RPC authentication against the `session` object:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "call",
     "params": [
       "00000000000000000000000000000000",
       "session",
       "login",
       {
         "username": "root",
         "password": "...",
         "timeout": 3600
       }
     ]
   }
   ```
3. Caches the returned `ubus_rpc_session` token.
4. On subsequent requests, the cached session is reused until expiration.
5. If the session expires prematurely (ubus return code `6` `UBUS_STATUS_PERMISSION_DENIED`), `UbusClient` automatically re-authenticates and retries the request once (without infinite retry loops).

## API Endpoints

### 1. Health Check
```http
GET /health
```

#### Response:
```json
{
  "status": "ok",
  "service": "openwrt-controller",
  "timestamp": "2026-09-22T16:26:43.250Z"
}
```

### 2. Connected Devices
```http
GET /api/devices
```

#### Query Parameters (Optional):
- `search` (string): Filter by MAC address, IP, or hostname.
- `interface` (string): Filter by network interface (e.g. `br-lan`).
- `connected` (boolean: `true`/`false`): Filter by connectivity state.

#### Sample Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "52:54:00:5b:2e:c1",
      "mac": "52:54:00:5B:2E:C1",
      "ip": "192.168.50.254",
      "hostname": null,
      "interface": "br-lan",
      "connected": true,
      "rxBytes": 0,
      "txBytes": 0
    }
  ],
  "devices": [ ... ],
  "count": 1
}
```

## Running Tests

```bash
# Run unit & route tests
npm test

# Build TypeScript
npm run build

# Start development server
npm run dev
```

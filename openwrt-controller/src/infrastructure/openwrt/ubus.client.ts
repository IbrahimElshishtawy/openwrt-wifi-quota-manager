import { env } from '../../config/env.js';
import { openWrtClient, type OpenWrtConfig } from './openwrt.client.js';

export interface UbusRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'call' | 'list';
  params: [string, string, string, Record<string, unknown>];
}

export interface UbusRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: [number, T];
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface RawDhcpLeaseEntry {
  mac: string;
  ip: string;
  hostname: string;
  expires: number;
  clientId?: string | undefined;
}

export interface RawArpEntry {
  ip: string;
  mac: string;
  device: string;
  flags: string;
}

export interface UbusClientConfig {
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  useHttps?: boolean | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Domain errors for OpenWrt communication
 */
export class OpenWrtNotConfiguredError extends Error {
  public readonly statusCode = 503;
  constructor(message = 'OpenWrt router connection is not configured in environment variables') {
    super(message);
    this.name = 'OpenWrtNotConfiguredError';
  }
}

export class OpenWrtConnectionError extends Error {
  public readonly statusCode = 502;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OpenWrtConnectionError';
  }
}

export class OpenWrtAuthError extends Error {
  public readonly statusCode = 502;
  constructor(message = 'Authentication failed against OpenWrt ubus RPC') {
    super(message);
    this.name = 'OpenWrtAuthError';
  }
}

export class OpenWrtRpcError extends Error {
  public readonly statusCode = 502;
  constructor(message: string, public readonly ubusCode?: number) {
    super(message);
    this.name = 'OpenWrtRpcError';
  }
}

const DEFAULT_SESSION = '00000000000000000000000000000000';
const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export const normalizeMac = (mac: string): string => {
  const trimmed = mac.trim();
  if (!MAC_REGEX.test(trimmed)) {
    throw new Error(`Invalid MAC address format: "${mac}"`);
  }
  return trimmed.replace(/-/g, ':').toUpperCase();
};

/**
 * Ubus Client for OpenWrt.
 * Interacts with OpenWrt's uhttpd-mod-ubus JSON-RPC endpoint (`/ubus`).
 * Handles session creation, token renewal, DHCP lease queries, and ARP table inspection.
 */
export class UbusClient {
  private sessionId: string = DEFAULT_SESSION;
  private sessionExpiresAt: number = 0;
  private requestId: number = 1;
  private readonly config: Required<OpenWrtConfig> & { timeoutMs: number };

  constructor(customConfig?: UbusClientConfig) {
    this.config = {
      host: customConfig?.host ?? env.OPENWRT_HOST ?? '',
      port: customConfig?.port ?? env.OPENWRT_PORT ?? 80,
      username: customConfig?.username ?? env.OPENWRT_USERNAME ?? '',
      password: customConfig?.password ?? env.OPENWRT_PASSWORD ?? '',
      useHttps: customConfig?.useHttps ?? env.OPENWRT_USE_HTTPS ?? false,
      timeoutMs: customConfig?.timeoutMs ?? 5000,
    };
  }

  private get baseUrl(): string {
    const protocol = this.config.useHttps ? 'https' : 'http';
    return `${protocol}://${this.config.host}:${this.config.port}/ubus`;
  }

  /**
   * Checks if required router parameters are configured.
   */
  public isConfigured(): boolean {
    return Boolean(this.config.host && this.config.username);
  }

  /**
   * Authenticates against OpenWrt /ubus session namespace.
   */
  public async login(): Promise<string> {
    if (!this.isConfigured()) {
      throw new OpenWrtNotConfiguredError();
    }

    const payload: UbusRpcRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'call',
      params: [
        DEFAULT_SESSION,
        'session',
        'login',
        {
          username: this.config.username,
          password: this.config.password,
        },
      ],
    };

    const res = await this.executeHttp<Record<string, unknown>>(payload);

    if (!res.result || res.result[0] !== 0) {
      throw new OpenWrtAuthError(
        `OpenWrt ubus authentication failed (code: ${res.result ? res.result[0] : 'unknown'})`
      );
    }

    const sessionData = res.result[1] as {
      ubus_rpc_session?: string;
      expires?: number;
      timeout?: number;
    };

    if (!sessionData.ubus_rpc_session) {
      throw new OpenWrtAuthError('ubus_rpc_session token missing in login response');
    }

    this.sessionId = sessionData.ubus_rpc_session;
    const ttlSeconds = sessionData.expires ?? sessionData.timeout ?? 300;
    this.sessionExpiresAt = Date.now() + ttlSeconds * 1000 - 10000; // 10s buffer

    return this.sessionId;
  }

  /**
   * Ensures an active session token before making ubus calls.
   */
  private async ensureSession(): Promise<string> {
    if (this.sessionId === DEFAULT_SESSION || Date.now() >= this.sessionExpiresAt) {
      return this.login();
    }
    return this.sessionId;
  }

  /**
   * Executes a low-level ubus RPC call with automatic session management.
   */
  public async call<T = unknown>(
    object: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const session = await this.ensureSession();

    const requestPayload: UbusRpcRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'call',
      params: [session, object, method, params],
    };

    try {
      const res = await this.executeHttp<T>(requestPayload);

      // Code 6 is UBUS_STATUS_PERMISSION_DENIED (session expired or invalid)
      if (res.result && res.result[0] === 6) {
        this.sessionId = DEFAULT_SESSION;
        const newSession = await this.login();
        requestPayload.params[0] = newSession;
        const retryRes = await this.executeHttp<T>(requestPayload);
        return this.parseResult(retryRes, object, method);
      }

      return this.parseResult(res, object, method);
    } catch (err) {
      if (err instanceof OpenWrtNotConfiguredError || err instanceof OpenWrtAuthError) {
        throw err;
      }
      if (err instanceof OpenWrtRpcError) {
        throw err;
      }
      throw new OpenWrtConnectionError(
        `Failed to communicate with OpenWrt router at ${this.config.host}:${this.config.port}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }

  /**
   * Performs the HTTP POST request to /ubus.
   */
  private async executeHttp<T>(payload: UbusRpcRequest): Promise<UbusRpcResponse<T>> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (fetchErr) {
      throw new OpenWrtConnectionError(
        `HTTP request to OpenWrt ubus (${this.baseUrl}) failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        fetchErr
      );
    }

    if (!response.ok) {
      throw new OpenWrtConnectionError(
        `OpenWrt ubus HTTP error: ${response.status} ${response.statusText}`
      );
    }

    let json: UbusRpcResponse<T>;
    try {
      json = (await response.json()) as UbusRpcResponse<T>;
    } catch (jsonErr) {
      throw new OpenWrtRpcError(
        `Failed to parse JSON-RPC response from OpenWrt: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`
      );
    }

    if (json.error) {
      throw new OpenWrtRpcError(
        `OpenWrt JSON-RPC error (${json.error.code}): ${json.error.message}`
      );
    }

    return json;
  }

  private parseResult<T>(res: UbusRpcResponse<T>, object: string, method: string): T {
    if (!res.result) {
      throw new OpenWrtRpcError(`No result returned from ubus call to ${object}.${method}`);
    }

    const [returnCode, data] = res.result;

    if (returnCode !== 0) {
      throw new OpenWrtRpcError(
        `ubus call ${object}.${method} returned error code ${returnCode}`,
        returnCode
      );
    }

    return data;
  }

  /**
   * Fetches active DHCP leases from OpenWrt.
   * Attempts luci-rpc getDHCPLeases first, then falls back to reading /tmp/dhcp.leases.
   */
  public async getDhcpLeases(): Promise<RawDhcpLeaseEntry[]> {
    // Attempt 1: luci-rpc module (if installed on OpenWrt)
    try {
      const luciData = await this.call<{
        dhcp_leases?: Array<{
          macaddr?: string;
          ipaddr?: string;
          hostname?: string;
          expires?: number;
        }>;
      }>('luci-rpc', 'getDHCPLeases');

      if (Array.isArray(luciData.dhcp_leases)) {
        const leases: RawDhcpLeaseEntry[] = [];
        for (const item of luciData.dhcp_leases) {
          if (!item.macaddr || !item.ipaddr) continue;
          try {
            leases.push({
              mac: normalizeMac(item.macaddr),
              ip: item.ipaddr,
              hostname: item.hostname && item.hostname !== '*' ? item.hostname : 'Unknown',
              expires: typeof item.expires === 'number' ? item.expires : 0,
            });
          } catch {
            // Ignore malformed MAC entries
          }
        }
        return leases;
      }
    } catch {
      // Fall through to file.read fallback
    }

    // Attempt 2: Read dnsmasq leases directly via standard rpcd file module
    const fileData = await this.call<{ data?: string }>('file', 'read', {
      path: '/tmp/dhcp.leases',
    });

    if (!fileData.data) {
      return [];
    }

    return this.parseDnsmasqLeases(fileData.data);
  }

  /**
   * Reads the kernel ARP table from /proc/net/arp via ubus file.read.
   */
  public async getArpTable(): Promise<RawArpEntry[]> {
    try {
      const fileData = await this.call<{ data?: string }>('file', 'read', {
        path: '/proc/net/arp',
      });

      if (!fileData.data) {
        return [];
      }

      return this.parseProcNetArp(fileData.data);
    } catch {
      return [];
    }
  }

  /**
   * Parses dnsmasq leases file text content.
   * Format: <timestamp> <mac> <ip> <hostname> <client_id>
   */
  public parseDnsmasqLeases(content: string): RawDhcpLeaseEntry[] {
    const leases: RawDhcpLeaseEntry[] = [];
    const lines = content.trim().split('\n');

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const [epochStr, rawMac, ip, hostname, clientId] = parts;
      if (!rawMac || !ip) continue;

      try {
        const normMac = normalizeMac(rawMac);
        const expires = parseInt(epochStr ?? '0', 10);

        leases.push({
          mac: normMac,
          ip,
          hostname: hostname && hostname !== '*' ? hostname : 'Unknown',
          expires: Number.isNaN(expires) ? 0 : expires,
          clientId: clientId ?? undefined,
        });
      } catch {
        // Skip malformed MAC addresses
      }
    }

    return leases;
  }

  /**
   * Parses /proc/net/arp content.
   * Format: IP HW_type Flags HW_address Mask Device
   */
  public parseProcNetArp(content: string): RawArpEntry[] {
    const entries: RawArpEntry[] = [];
    const lines = content.trim().split('\n');

    // Skip the first line (header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;

      const [ip, , flags, rawMac, , device] = parts;
      if (!rawMac || !ip || !device || !flags) continue;
      if (rawMac === '00:00:00:00:00:00') continue;

      try {
        entries.push({
          ip,
          mac: normalizeMac(rawMac),
          device,
          flags,
        });
      } catch {
        // Skip malformed MACs
      }
    }

    return entries;
  }
}

// Singleton UbusClient instance using environment defaults
export const ubusClient = new UbusClient();

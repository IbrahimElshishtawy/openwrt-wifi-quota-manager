import axios, { type AxiosInstance, isAxiosError } from 'axios';
import { env } from '../../config/env.js';

export interface UbusClientConfig {
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  useHttps?: boolean | undefined;
  timeoutMs?: number | undefined;
}

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

/**
 * Domain errors for OpenWrt communication
 */
export class OpenWrtNotConfiguredError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'OPENWRT_NOT_CONFIGURED';

  constructor(message = 'OpenWrt router connection is not configured in environment variables') {
    super(message);
    this.name = 'OpenWrtNotConfiguredError';
  }
}

export class OpenWrtConnectionError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'OPENWRT_UNAVAILABLE';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'OpenWrtConnectionError';
  }
}

export class UbusAuthenticationError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'UBUS_AUTH_ERROR';

  constructor(message = 'Authentication failed against OpenWrt ubus RPC') {
    super(message);
    this.name = 'UbusAuthenticationError';
  }
}

export class UbusRequestError extends Error {
  public readonly statusCode = 502;
  public readonly code = 'UBUS_REQUEST_ERROR';

  constructor(
    message: string,
    public readonly ubusCode?: number,
    public readonly rpcErrorCode?: number
  ) {
    super(message);
    this.name = 'UbusRequestError';
  }
}

const DEFAULT_SESSION = '00000000000000000000000000000000';

/**
 * Generic reusable Ubus Client for OpenWrt.
 * Interacts with OpenWrt's uhttpd-mod-ubus JSON-RPC endpoint (`/ubus`) using Axios.
 * Handles session creation, token reuse/renewal, 1-retry session recovery, and timeouts.
 * Contains ZERO device-specific logic so it can be reused for any subsystem
 * (network, system, uci, dhcp, hostapd, firewall).
 */
export class UbusClient {
  private sessionId: string | null = null;
  private sessionExpiresAt: number = 0;
  private requestId: number = 1;
  private readonly httpClient: AxiosInstance;
  private readonly config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    useHttps: boolean;
    timeoutMs: number;
  };

  constructor(customConfig?: UbusClientConfig) {
    this.config = {
      host: customConfig?.host ?? env.OPENWRT_HOST ?? '',
      port: customConfig?.port ?? env.OPENWRT_PORT ?? 80,
      username: customConfig?.username ?? env.OPENWRT_USERNAME ?? '',
      password: customConfig?.password ?? env.OPENWRT_PASSWORD ?? '',
      useHttps: customConfig?.useHttps ?? env.OPENWRT_USE_HTTPS ?? false,
      timeoutMs: customConfig?.timeoutMs ?? 5000,
    };

    const protocol = this.config.useHttps ? 'https' : 'http';
    const baseURL = `${protocol}://${this.config.host}:${this.config.port}/ubus`;

    this.httpClient = axios.create({
      baseURL,
      timeout: this.config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  /**
   * Check whether all required parameters to connect to OpenWrt are present.
   */
  public isConfigured(): boolean {
    return Boolean(this.config.host && this.config.username);
  }

  /**
   * Authenticates against OpenWrt /ubus session namespace using JSON-RPC.
   * Caches session ID and expiration timestamp.
   * Strict security: Never logs or surfaces the password or raw session token.
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
          password: this.config.password ?? '',
          timeout: 3600,
        },
      ],
    };

    let responseData: UbusRpcResponse<Record<string, unknown>>;
    try {
      const response = await this.httpClient.post<UbusRpcResponse<Record<string, unknown>>>('', payload);
      responseData = response.data;
    } catch (err) {
      if (isAxiosError(err)) {
        throw new OpenWrtConnectionError(
          `Unable to connect to OpenWrt router at ${this.config.host}:${this.config.port}: ${err.message}`,
          err
        );
      }
      throw new OpenWrtConnectionError(
        `Unexpected connection error to OpenWrt router: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    if (responseData.error) {
      throw new UbusAuthenticationError(
        `OpenWrt ubus authentication error (${responseData.error.code}): ${responseData.error.message}`
      );
    }

    if (!responseData.result || responseData.result[0] !== 0) {
      const errCode = responseData.result ? responseData.result[0] : 'unknown';
      throw new UbusAuthenticationError(`OpenWrt ubus authentication failed with code: ${errCode}`);
    }

    const sessionData = responseData.result[1] as {
      ubus_rpc_session?: string;
      expires?: number;
      timeout?: number;
    };

    if (!sessionData?.ubus_rpc_session) {
      throw new UbusAuthenticationError('ubus_rpc_session token missing in login response');
    }

    this.sessionId = sessionData.ubus_rpc_session;
    const ttlSeconds = sessionData.expires ?? sessionData.timeout ?? 3600;
    // Refresh 15 seconds before expiration
    this.sessionExpiresAt = Date.now() + ttlSeconds * 1000 - 15000;

    return this.sessionId;
  }

  /**
   * Ensures an active session token exists before executing a ubus call.
   */
  private async ensureSession(): Promise<string> {
    if (!this.sessionId || Date.now() >= this.sessionExpiresAt) {
      return this.login();
    }
    return this.sessionId;
  }

  /**
   * Executes a generic Ubus JSON-RPC call.
   * Reusable for any object and method (e.g. system, network, uci, dhcp, luci-rpc, file).
   * Automatically renews session and retries once if session expired (ubus error 6).
   */
  public async call<T = unknown>(
    object: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    return this.executeCall<T>(object, method, params, false);
  }

  private async executeCall<T>(
    object: string,
    method: string,
    params: Record<string, unknown>,
    isRetry: boolean
  ): Promise<T> {
    const session = await this.ensureSession();

    const requestPayload: UbusRpcRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'call',
      params: [session, object, method, params],
    };

    let responseData: UbusRpcResponse<T>;
    try {
      const response = await this.httpClient.post<UbusRpcResponse<T>>('', requestPayload);
      responseData = response.data;
    } catch (err) {
      if (isAxiosError(err)) {
        throw new OpenWrtConnectionError(
          `Ubus request to ${object}.${method} failed at ${this.config.host}:${this.config.port}: ${err.message}`,
          err
        );
      }
      throw new OpenWrtConnectionError(
        `Unexpected error communicating with OpenWrt router: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    if (responseData.error) {
      throw new UbusRequestError(
        `Ubus RPC error (${responseData.error.code}) on ${object}.${method}: ${responseData.error.message}`,
        undefined,
        responseData.error.code
      );
    }

    if (!responseData.result) {
      throw new UbusRequestError(`No result returned from ubus call to ${object}.${method}`);
    }

    const [ubusReturnCode, data] = responseData.result;

    // Code 6 is UBUS_STATUS_PERMISSION_DENIED (session expired or invalid)
    if (ubusReturnCode === 6 && !isRetry) {
      // Clear session, re-login once, and retry
      this.sessionId = null;
      await this.login();
      return this.executeCall<T>(object, method, params, true);
    }

    if (ubusReturnCode !== 0) {
      throw new UbusRequestError(
        `Ubus call ${object}.${method} returned status code ${ubusReturnCode}`,
        ubusReturnCode
      );
    }

    return data;
  }
}

// Default singleton instance using environment variables
export const ubusClient = new UbusClient();

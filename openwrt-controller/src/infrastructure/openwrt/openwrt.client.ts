import { env } from '../../config/env.js';

export interface OpenWrtConfig {
  host?: string | undefined;
  port: number;
  username?: string | undefined;
  password?: string | undefined;
  useHttps: boolean;
}

export interface SafeOpenWrtConfig {
  host: string | null;
  port: number;
  username: string | null;
  useHttps: boolean;
  hasPassword: boolean;
  isConfigured: boolean;
}

/**
 * OpenWrt Infrastructure Base Client.
 *
 * Designed to orchestrate communication with the OpenWrt router (via ubus, nlbwmon, UCI, and nftables).
 * Adheres to Phase 1 non-blocking requirements:
 * - Does not attempt network connections during server startup.
 * - Starts normally even if router credentials have not been configured yet.
 * - Strictly prevents logging or exposing raw passwords.
 */
export class OpenWrtClient {
  private readonly config: OpenWrtConfig;

  constructor(customConfig?: Partial<OpenWrtConfig>) {
    this.config = {
      host: customConfig?.host ?? env.OPENWRT_HOST,
      port: customConfig?.port ?? env.OPENWRT_PORT,
      username: customConfig?.username ?? env.OPENWRT_USERNAME,
      password: customConfig?.password ?? env.OPENWRT_PASSWORD,
      useHttps: customConfig?.useHttps ?? env.OPENWRT_USE_HTTPS,
    };
  }

  /**
   * Check whether all required credentials to connect to OpenWrt are present.
   */
  public isConfigured(): boolean {
    return Boolean(
      this.config.host &&
      this.config.username &&
      this.config.password
    );
  }

  /**
   * Returns a sanitized view of the router configuration safe for logging and debugging.
   * NEVER returns or logs the raw password.
   */
  public getSafeConfig(): SafeOpenWrtConfig {
    return {
      host: this.config.host ?? null,
      port: this.config.port,
      username: this.config.username ?? null,
      useHttps: this.config.useHttps,
      hasPassword: Boolean(this.config.password && this.config.password.length > 0),
      isConfigured: this.isConfigured(),
    };
  }
}

// Singleton client instance initialized with environment configuration
export const openWrtClient = new OpenWrtClient();

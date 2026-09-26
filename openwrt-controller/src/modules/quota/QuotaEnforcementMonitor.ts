import { env } from '../../config/env.js';
import { QuotaService, quotaService as defaultQuotaService } from './QuotaService.js';
import { FirewallService, firewallService as defaultFirewallService } from '../firewall/FirewallService.js';
import type { IFirewallService } from '../firewall/IFirewallService.js';
import type { DeviceQuota } from './types.js';

export interface IEnforcementLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug?(msg: string, ...args: unknown[]): void;
}

const defaultLogger: IEnforcementLogger = {
  info: (msg, ...args) => console.log(`[QuotaEnforcementMonitor] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[QuotaEnforcementMonitor] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[QuotaEnforcementMonitor] ${msg}`, ...args),
};

export interface QuotaEnforcementMonitorOptions {
  intervalMs?: number;
  enabled?: boolean;
  logger?: IEnforcementLogger;
}

export interface IQuotaEnforcementMonitor {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  sync(): Promise<void>;
  isRunning(): boolean;
}

export interface EnforcementCycleResult {
  timestamp: string;
  durationMs: number;
  totalEvaluated: number;
  blockedCount: number;
  unblockedCount: number;
  unchangedCount: number;
  errorCount: number;
  results: Array<{
    mac: string;
    action: 'blocked' | 'unblocked' | 'none';
    quotaStatus: string;
    success: boolean;
    reason?: string | undefined;
    error?: string | undefined;
  }>;
  success: boolean;
  error?: string | undefined;
}

export interface EnforcementMonitorStatus {
  running: boolean;
  intervalMs: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunSuccess: boolean | null;
  lastError: string | null;
  totalRuns: number;
  consecutiveErrors: number;
}

/**
 * Production-ready Quota Enforcement Monitor.
 *
 * Coordinates:
 *   UsageService -> QuotaService -> QuotaEnforcementMonitor -> FirewallService -> nftables
 *
 * Responsibilities:
 * - Periodically and idempotently evaluates all quotas.
 * - Detects state transitions (active <-> exhausted).
 * - Only blocks devices that have exhausted their quota; LAN devices with active quotas remain online.
 * - Restores internet access (unblocks) immediately when a quota is reset or deleted.
 * - Maintains an in-memory enforcement state cache to avoid redundant SSH/nftables operations.
 * - Prevents overlapping executions using an active mutex lock (`isSyncing`).
 * - Isolates device errors so a failure on one device never stops processing other devices.
 * - Clean lifecycle management (start, stop, sync) with proper timer cleanup on shutdown.
 */
export class QuotaEnforcementMonitor implements IQuotaEnforcementMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private running = false;
  private readonly intervalMs: number;
  private readonly enabled: boolean;
  private readonly logger: IEnforcementLogger;

  // In-memory enforcement state cache to track transitions: Map<MAC, "blocked" | "unblocked">
  private enforcementState = new Map<string, 'blocked' | 'unblocked'>();

  // Telemetry state
  private lastRunAt: string | null = null;
  private lastRunDurationMs: number | null = null;
  private lastRunSuccess: boolean | null = null;
  private lastError: string | null = null;
  private totalRuns = 0;
  private consecutiveErrors = 0;

  constructor(
    private readonly quotaService: QuotaService = defaultQuotaService,
    private readonly firewallService: IFirewallService = defaultFirewallService,
    options: QuotaEnforcementMonitorOptions = {}
  ) {
    this.intervalMs = Math.max(
      1000,
      options.intervalMs ?? env.QUOTA_ENFORCEMENT_INTERVAL_MS ?? 5000
    );
    this.enabled = options.enabled ?? env.QUOTA_ENFORCEMENT_ENABLED ?? true;
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Starts periodic quota enforcement.
   * Calling start() multiple times is safe and preserves a single timer.
   * Does not start if enforcement is disabled.
   */
  public start(): void {
    if (!this.enabled) {
      this.logger.info('Quota enforcement monitor is disabled via configuration');
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    this.logger.info(`Started Quota Enforcement Monitor (interval: ${this.intervalMs}ms)`);

    // 1. Run first synchronization cycle immediately
    void this.sync();

    // 2. Schedule periodic timer
    this.timer = setInterval(() => {
      void this.sync();
    }, this.intervalMs);

    // Unref timer so it does not prevent clean process exit
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops periodic quota enforcement.
   * Cleans up running timer and is safe to call multiple times.
   */
  public stop(): void {
    if (!this.running && this.timer === null) {
      return;
    }

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('Stopped Quota Enforcement Monitor');
  }

  /**
   * Indicates whether the monitor timer is actively running.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Executes a single synchronization cycle coordinating QuotaService and FirewallService.
   * Protected by a mutex lock (isSyncing) to prevent overlapping executions.
   */
  public async sync(): Promise<void> {
    await this.runCycle();
  }

  /**
   * Executes an enforcement cycle and returns full execution telemetry.
   */
  public async runCycle(): Promise<EnforcementCycleResult | null> {
    // Overlapping execution prevention lock
    if (this.isSyncing) {
      this.logger.warn('Previous quota enforcement cycle is still in progress; skipping overlapping run');
      return null;
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      // 1. Fetch fresh quotas from QuotaService (incorporating fresh usage from UsageService)
      let quotas: DeviceQuota[] = [];
      try {
        quotas = await this.quotaService.refreshAllQuotas();
      } catch (err: unknown) {
        const errMsg = this.sanitizeErrorMessage(err);
        this.logger.error(`Failed to refresh quotas from router: ${errMsg}`);

        const durationMs = Date.now() - startTime;
        this.updateTelemetry(timestamp, durationMs, false, errMsg);

        return {
          timestamp,
          durationMs,
          totalEvaluated: 0,
          blockedCount: 0,
          unblockedCount: 0,
          unchangedCount: 0,
          errorCount: 1,
          results: [],
          success: false,
          error: `Router/Usage refresh failure: ${errMsg}`,
        };
      }

      const currentQuotaMacs = new Set(quotas.map((q) => q.mac));
      let blockedCount = 0;
      let unblockedCount = 0;
      let unchangedCount = 0;
      let errorCount = 0;
      const results: EnforcementCycleResult['results'] = [];

      // 2. Evaluate each quota record
      for (const quota of quotas) {
        const mac = quota.mac;
        try {
          if (quota.status === 'exhausted') {
            const cachedState = this.enforcementState.get(mac);

            // Fast path: if already cached as blocked, skip redundant firewall call
            if (cachedState === 'blocked') {
              unchangedCount++;
              results.push({
                mac,
                action: 'none',
                quotaStatus: 'exhausted',
                success: true,
                reason: 'Already blocked by quota enforcement',
              });
              continue;
            }

            // Verify if already blocked in firewall (handles service restarts gracefully)
            const isAlreadyBlocked = await this.firewallService.isBlocked(mac, 'quota');
            if (isAlreadyBlocked) {
              this.enforcementState.set(mac, 'blocked');
              unchangedCount++;
              results.push({
                mac,
                action: 'none',
                quotaStatus: 'exhausted',
                success: true,
                reason: 'Already blocked in firewall',
              });
              continue;
            }

            // State Transition: ACTIVE -> EXHAUSTED -> BLOCK
            await this.firewallService.blockDevice(mac, 'quota');
            this.enforcementState.set(mac, 'blocked');
            blockedCount++;

            this.logger.info(`Quota enforcement: ${mac} ACTIVE → EXHAUSTED → BLOCKED`);

            results.push({
              mac,
              action: 'blocked',
              quotaStatus: 'exhausted',
              success: true,
              reason: 'Quota exhausted; device blocked',
            });
          } else if (quota.status === 'active') {
            const cachedState = this.enforcementState.get(mac);

            // Fast path: if already cached as unblocked, skip redundant firewall call
            if (cachedState === 'unblocked') {
              unchangedCount++;
              results.push({
                mac,
                action: 'none',
                quotaStatus: 'active',
                success: true,
                reason: 'Device is active and unblocked',
              });
              continue;
            }

            // Check if device was previously blocked by quota enforcement
            const wasBlocked =
              cachedState === 'blocked' ||
              (await this.firewallService.isBlocked(mac, 'quota'));

            if (wasBlocked) {
              // State Transition: EXHAUSTED -> ACTIVE -> UNBLOCK
              await this.firewallService.unblockDevice(mac, 'quota');
              this.enforcementState.set(mac, 'unblocked');
              unblockedCount++;

              this.logger.info(`Quota enforcement: ${mac} EXHAUSTED → ACTIVE → UNBLOCKED`);

              results.push({
                mac,
                action: 'unblocked',
                quotaStatus: 'active',
                success: true,
                reason: 'Quota active; device unblocked',
              });
            } else {
              this.enforcementState.set(mac, 'unblocked');
              unchangedCount++;
              results.push({
                mac,
                action: 'none',
                quotaStatus: 'active',
                success: true,
                reason: 'Device is active and unblocked',
              });
            }
          }
        } catch (devErr: unknown) {
          errorCount++;
          const errMsg = this.sanitizeErrorMessage(devErr);
          this.logger.error(`Quota enforcement error for ${mac}: ${errMsg}`, {
            mac,
            error: errMsg,
          });

          results.push({
            mac,
            action: 'none',
            quotaStatus: quota.status,
            success: false,
            error: errMsg,
          });
          // Error isolation: continue evaluating remaining devices
        }
      }

      // 3. Scenario F: Handle Deleted Quotas
      // Check cached blocked state for MACs whose quota was deleted
      for (const [cachedMac, state] of Array.from(this.enforcementState.entries())) {
        if (!currentQuotaMacs.has(cachedMac)) {
          if (state === 'blocked') {
            try {
              await this.firewallService.unblockDevice(cachedMac, 'quota');
              unblockedCount++;
              this.logger.info(`Quota enforcement: ${cachedMac} QUOTA DELETED → UNBLOCKED`);
            } catch (err: unknown) {
              errorCount++;
              const errMsg = this.sanitizeErrorMessage(err);
              this.logger.error(`Failed to unblock deleted quota device ${cachedMac}: ${errMsg}`);
            }
          }
          this.enforcementState.delete(cachedMac);
        }
      }

      // Also clean up any orphan quota blocks reported by FirewallService
      if (typeof this.firewallService.getBlockedDevices === 'function') {
        try {
          const quotaBlockedMacs = await this.firewallService.getBlockedDevices('quota');
          for (const blockedMac of quotaBlockedMacs) {
            if (!currentQuotaMacs.has(blockedMac)) {
              await this.firewallService.unblockDevice(blockedMac, 'quota');
              this.enforcementState.delete(blockedMac);
              unblockedCount++;
              this.logger.info(`Quota enforcement: ${blockedMac} ORPHAN QUOTA BLOCK → UNBLOCKED`);
            }
          }
        } catch {
          // Non-fatal if firewall repository query fails
        }
      }

      const durationMs = Date.now() - startTime;
      const cycleSuccess = errorCount === 0;
      this.updateTelemetry(
        timestamp,
        durationMs,
        cycleSuccess,
        errorCount > 0 ? `${errorCount} device error(s)` : null
      );

      return {
        timestamp,
        durationMs,
        totalEvaluated: quotas.length,
        blockedCount,
        unblockedCount,
        unchangedCount,
        errorCount,
        results,
        success: cycleSuccess,
        error: errorCount > 0 ? `${errorCount} device enforcement error(s) occurred` : undefined,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Resets the in-memory transition cache (e.g. for testing).
   */
  public clearCache(): void {
    this.enforcementState.clear();
  }

  /**
   * Returns current monitor telemetry and health status.
   */
  public getStatus(): EnforcementMonitorStatus {
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      enabled: this.enabled,
      lastRunAt: this.lastRunAt,
      lastRunDurationMs: this.lastRunDurationMs,
      lastRunSuccess: this.lastRunSuccess,
      lastError: this.lastError,
      totalRuns: this.totalRuns,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  private updateTelemetry(
    timestamp: string,
    durationMs: number,
    success: boolean,
    error: string | null
  ): void {
    this.lastRunAt = timestamp;
    this.lastRunDurationMs = durationMs;
    this.lastRunSuccess = success;
    this.totalRuns++;

    if (success) {
      this.lastError = null;
      this.consecutiveErrors = 0;
    } else {
      this.lastError = error;
      this.consecutiveErrors++;
    }
  }

  private sanitizeErrorMessage(err: unknown): string {
    if (!err) return 'Unknown error';
    let msg = err instanceof Error ? err.message : String(err);
    msg = msg.replace(/(password|token|secret)=[^&\s]+/gi, '$1=[REDACTED]');
    return msg;
  }
}

export const quotaEnforcementMonitor = new QuotaEnforcementMonitor();

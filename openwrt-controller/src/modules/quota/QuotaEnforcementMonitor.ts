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
   * Public alias for reconciliation cycle.
   */
  public async reconcile(): Promise<EnforcementCycleResult | null> {
    return this.runCycle();
  }

  /**
   * Executes an enforcement cycle and returns full execution telemetry.
   *
   * Reconciliation Algorithm:
   * 1. Fetches desired quota states from QuotaService (source of truth for quotas).
   * 2. Fetches actual nftables blocked MACs from FirewallService (source of truth for firewall).
   * 3. Calculates missing blocks (desired - actual) and stale blocks (actual - desired).
   * 4. Reconstructs in-memory enforcement state and updates router ruleset without redundant commands.
   * 5. Strictly protects manual administrative blocks from removal.
   * 6. Isolates device failures so an error on one device never halts reconciliation for others.
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

      // 2. Fetch actual blocked MACs from firewall (inspecting table inet quota_enforcement set blocked_macs)
      let actualBlockedList: string[] = [];
      try {
        actualBlockedList = await this.firewallService.getBlockedDevices();
      } catch (err: unknown) {
        const errMsg = this.sanitizeErrorMessage(err);
        this.logger.error(`Failed to retrieve actual blocked devices from firewall: ${errMsg}`);

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
          error: `Firewall fetch failure: ${errMsg}`,
        };
      }

      const actualBlockedSet = new Set(actualBlockedList.map((m) => m.toUpperCase()));

      // 3. Determine desired blocked state from QuotaService
      const desiredBlockedSet = new Set<string>();
      const quotaMap = new Map<string, DeviceQuota>();

      for (const quota of quotas) {
        const normMac = quota.mac.toUpperCase();
        quotaMap.set(normMac, quota);
        if (quota.status === 'exhausted' || quota.usedBytes >= quota.quotaBytes) {
          desiredBlockedSet.add(normMac);
        }
      }

      let blockedCount = 0;
      let unblockedCount = 0;
      let unchangedCount = 0;
      let errorCount = 0;
      const results: EnforcementCycleResult['results'] = [];
      const evaluatedMacs = new Set<string>();

      // 4. Evaluate each configured device quota
      for (const quota of quotas) {
        const mac = quota.mac.toUpperCase();
        evaluatedMacs.add(mac);

        try {
          const isDesiredBlocked = desiredBlockedSet.has(mac);
          const isActuallyBlocked = actualBlockedSet.has(mac);

          if (isDesiredBlocked) {
            // DESIRED: BLOCKED (quota is exhausted)
            const isQuotaRecorded = await this.firewallService.isBlocked(mac, 'quota');

            if (isActuallyBlocked && isQuotaRecorded) {
              // Already blocked in nftables and recorded in ownership state: safe idempotent no-op
              this.enforcementState.set(mac, 'blocked');
              unchangedCount++;
              results.push({
                mac,
                action: 'none',
                quotaStatus: 'exhausted',
                success: true,
                reason: 'Already blocked in firewall',
              });
            } else {
              // MISSING BLOCK: (Newly exhausted, router rebooted, or missing quota block ownership)
              this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=blocked actual=unblocked action=block`);
              await this.firewallService.blockDevice(mac, 'quota');
              this.enforcementState.set(mac, 'blocked');
              this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=blocked actual=unblocked action=block result=success`);
              blockedCount++;
              results.push({
                mac,
                action: 'blocked',
                quotaStatus: 'exhausted',
                success: true,
                reason: 'Quota exhausted; device blocked by reconciliation',
              });
            }
          } else {
            // DESIRED: UNBLOCKED (quota is active)
            const isQuotaRecorded = await this.firewallService.isBlocked(mac, 'quota');
            const isManualBlocked = await this.firewallService.isBlocked(mac, 'manual');

            if (isQuotaRecorded || (isActuallyBlocked && !isManualBlocked)) {
              if (isManualBlocked) {
                // Manual admin block protection: remove quota ownership, but manual block remains in nftables
                await this.firewallService.unblockDevice(mac, 'quota');
                this.enforcementState.set(mac, 'unblocked');
                unchangedCount++;
                this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=unblocked actual=blocked action=preserve reason="manual_block_protected"`);
                results.push({
                  mac,
                  action: 'none',
                  quotaStatus: 'active',
                  success: true,
                  reason: 'Active quota; device remains blocked by manual administrator block',
                });
              } else {
                // STALE BLOCK: Quota is active; unblock device to restore access
                this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=unblocked actual=blocked action=unblock`);
                await this.firewallService.unblockDevice(mac, 'quota');
                this.enforcementState.set(mac, 'unblocked');
                this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=unblocked actual=blocked action=unblock result=success`);
                unblockedCount++;
                results.push({
                  mac,
                  action: 'unblocked',
                  quotaStatus: 'active',
                  success: true,
                  reason: 'Quota active; device unblocked by reconciliation',
                });
              }
            } else {
              // Desired = unblocked, Actual = unblocked
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
          const actionStr = desiredBlockedSet.has(mac) ? 'block' : 'unblock';
          const desiredStr = desiredBlockedSet.has(mac) ? 'blocked' : 'unblocked';
          const actualStr = actualBlockedSet.has(mac) ? 'blocked' : 'unblocked';
          this.logger.error(
            `[QuotaReconciliation] MAC=${mac} desired=${desiredStr} actual=${actualStr} action=${actionStr} result=error error="${errMsg}"`
          );
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

      // 5. Reconcile stale blocks in nftables for deleted quotas or orphan blocks
      for (const blockedMac of actualBlockedSet) {
        if (evaluatedMacs.has(blockedMac)) {
          continue;
        }
        evaluatedMacs.add(blockedMac);

        try {
          const isManual = await this.firewallService.isBlocked(blockedMac, 'manual');
          if (isManual) {
            // Protected manual block without a quota: do not touch
            continue;
          }

          // Device has no configured quota, is in nftables, and is NOT manually blocked
          this.logger.info(`[QuotaReconciliation] MAC=${blockedMac} desired=unblocked actual=blocked action=unblock`);
          await this.firewallService.unblockDevice(blockedMac, 'quota');
          this.enforcementState.delete(blockedMac);
          this.logger.info(`[QuotaReconciliation] MAC=${blockedMac} desired=unblocked actual=blocked action=unblock result=success`);
          unblockedCount++;
          results.push({
            mac: blockedMac,
            action: 'unblocked',
            quotaStatus: 'deleted',
            success: true,
            reason: 'Quota deleted or missing; device unblocked by reconciliation',
          });
        } catch (err: unknown) {
          errorCount++;
          const errMsg = this.sanitizeErrorMessage(err);
          this.logger.error(
            `[QuotaReconciliation] MAC=${blockedMac} desired=unblocked actual=blocked action=unblock result=error error="${errMsg}"`
          );
          results.push({
            mac: blockedMac,
            action: 'none',
            quotaStatus: 'deleted',
            success: false,
            error: errMsg,
          });
          // Error isolation: continue evaluating remaining devices
        }
      }

      // 6. Clean up in-memory state entries for MACs that no longer exist anywhere
      for (const cachedMac of Array.from(this.enforcementState.keys())) {
        if (!quotaMap.has(cachedMac) && !actualBlockedSet.has(cachedMac)) {
          this.enforcementState.delete(cachedMac);
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

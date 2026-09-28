import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { QuotaService, quotaService as defaultQuotaService } from './QuotaService.js';
import { FirewallService, firewallService as defaultFirewallService } from '../firewall/FirewallService.js';
import type { IFirewallService } from '../firewall/IFirewallService.js';
import type { DeviceQuota } from './types.js';
import { Logger, logger as defaultStructuredLogger } from '../../infrastructure/logging/Logger.js';
import type { ILogger } from '../../infrastructure/logging/logger.types.js';
import { metricsService as defaultMetricsService, MetricsService } from '../../infrastructure/metrics/MetricsService.js';
import { classifyError } from '../quota-enforcement/errors.js';
import { CircuitBreaker, circuitBreaker as defaultCircuitBreaker } from '../../infrastructure/resilience/CircuitBreaker.js';
import { RetryPolicy, retryPolicy as defaultRetryPolicy } from '../../infrastructure/resilience/RetryPolicy.js';

export interface IEnforcementLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug?(msg: string, ...args: unknown[]): void;
}

const defaultConsoleLogger: IEnforcementLogger = {
  info: (msg, ...args) => console.log(`[QuotaEnforcementMonitor] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[QuotaEnforcementMonitor] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[QuotaEnforcementMonitor] ${msg}`, ...args),
};

export interface QuotaEnforcementMonitorOptions {
  intervalMs?: number;
  enabled?: boolean;
  logger?: IEnforcementLogger;
  structuredLogger?: ILogger;
  metrics?: MetricsService;
  circuitBreaker?: CircuitBreaker;
  retryPolicy?: RetryPolicy;
}

export interface IQuotaEnforcementMonitor {
  start(options?: { skipInitialSync?: boolean }): Promise<void> | void;
  stop(options?: { waitForCycle?: boolean; timeoutMs?: number }): Promise<void> | void;
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
  reconciliationId?: string | undefined;
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
  syncInProgress?: boolean;
  lastStartedAt?: string | null;
  lastCompletedAt?: string | null;
  lastSuccessfulAt?: string | null;
  lastFailureAt?: string | null;
  lastDurationMs?: number | null;
  devicesEvaluated?: number;
  devicesBlocked?: number;
  devicesUnblocked?: number;
  reconciliationId?: string | null;
}

/**
 * ARCHITECTURE & SOURCE OF TRUTH:
 *
 * Logical Data Flow:
 *   UsageService (nlbwmon cumulative traffic counters from OpenWrt)
 *       ↓
 *   QuotaService (evaluates usedBytes, remainingBytes, status: 'active' | 'exhausted')
 *       ↓
 *   Quota status (source of truth: database/file-backed FileQuotaRepository)
 *       ↓
 *   QuotaEnforcementMonitor (evaluates desired quota status vs actual router firewall state)
 *       ↓
 *   FirewallService (coordinates block ownership: manual vs quota-enforced)
 *       ↓
 *   nftables on OpenWrt (enforcement state: table inet quota_enforcement set blocked_macs)
 *
 * Source of Truth Principles:
 * 1. The database/file-backed quota storage (FileQuotaRepository) is the authoritative source
 *    of truth for:
 *    - Quota existence
 *    - Quota bandwidth limits
 *    - Usage counter progression & baselines
 *    - Active vs. exhausted status
 * 2. The OpenWrt nftables state is the actual enforcement state.
 * 3. In-memory caches are NEVER assumed to be authoritative; every cycle evaluates actual
 *    quota records and actual nftables elements.
 * 4. Manual firewall blocks created by administrators are strictly protected and never removed
 *    by the quota enforcement system.
 * 5. Device error isolation ensures a failure on one device never halts processing of others.
 */
export class QuotaEnforcementMonitor implements IQuotaEnforcementMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private running = false;
  private readonly intervalMs: number;
  private readonly enabled: boolean;
  private readonly logger: IEnforcementLogger;
  private readonly structuredLogger: ILogger;
  private readonly metrics: MetricsService;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;

  private isInitialRun = true;

  // In-memory observation cache to record state transitions: Map<MAC, "blocked" | "unblocked">
  private enforcementState = new Map<string, 'blocked' | 'unblocked'>();

  // Telemetry state
  private lastRunAt: string | null = null;
  private lastRunDurationMs: number | null = null;
  private lastRunSuccess: boolean | null = null;
  private lastError: string | null = null;
  private totalRuns = 0;
  private consecutiveErrors = 0;

  private lastStartedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastSuccessfulAt: string | null = null;
  private lastFailureAt: string | null = null;
  private devicesEvaluated = 0;
  private devicesBlocked = 0;
  private devicesUnblocked = 0;
  private currentReconciliationId: string | null = null;

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
    this.logger = options.logger ?? defaultConsoleLogger;
    this.structuredLogger = options.structuredLogger ?? defaultStructuredLogger;
    this.metrics = options.metrics ?? defaultMetricsService;
    this.circuitBreaker = options.circuitBreaker ?? defaultCircuitBreaker;
    this.retryPolicy = options.retryPolicy ?? defaultRetryPolicy;
  }

  /**
   * Starts periodic quota enforcement.
   * Calling start() multiple times is safe and preserves a single timer.
   * Executes startup reconciliation immediately unless skipped.
   * Does not start if enforcement is disabled.
   */
  public async start(options?: { skipInitialSync?: boolean }): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Quota enforcement monitor is disabled via configuration');
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    this.logger.info(`Started Quota Enforcement Monitor (interval: ${this.intervalMs}ms)`);

    // 1. Run first synchronization cycle immediately unless skipped
    if (!options?.skipInitialSync) {
      try {
        await this.sync();
      } catch (err: unknown) {
        this.logger.warn(`Initial startup synchronization warning: ${this.sanitizeErrorMessage(err)}`);
      }
    }

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
   * Cleans up running timer and supports graceful waiting for in-flight cycles.
   */
  public async stop(options?: { waitForCycle?: boolean; timeoutMs?: number }): Promise<void> {
    if (!this.running && this.timer === null && !this.isSyncing) {
      return;
    }

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (options?.waitForCycle && this.isSyncing) {
      const timeoutMs = options.timeoutMs ?? 3000;
      const startWait = Date.now();
      while (this.isSyncing && Date.now() - startWait < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    this.logger.info('Stopped Quota Enforcement Monitor');
  }

  /**
   * Indicates whether the monitor timer is actively running.
   */
  public isRunning(): boolean {
    return this.running;
  }

  public isSyncInProgress(): boolean {
    return this.isSyncing;
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
    const reconciliationId = randomUUID();
    this.currentReconciliationId = reconciliationId;
    this.lastStartedAt = timestamp;

    const cycleLogger = this.structuredLogger.withCorrelationId(reconciliationId);

    // 0. Circuit Breaker protection: avoid hammering SSH if router is down
    if (this.circuitBreaker.isOpen()) {
      this.logger.warn('Circuit breaker is OPEN: OpenWrt router operations paused; skipping cycle');
      cycleLogger.warn('circuit_breaker_open', {
        reconciliationId,
        message: 'OpenWrt router operations paused by circuit breaker',
      });

      const durationMs = Date.now() - startTime;
      const isoNow = new Date().toISOString();
      this.lastCompletedAt = isoNow;
      this.lastFailureAt = isoNow;
      this.updateTelemetry(timestamp, durationMs, false, 'Circuit breaker is OPEN: external router calls suppressed');
      this.metrics.increment('reconciliation_runs');
      this.metrics.increment('reconciliation_failures');

      this.isSyncing = false;
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
        error: 'Circuit breaker is OPEN: external router calls suppressed',
        reconciliationId,
      };
    }

    this.metrics.increment('reconciliation_runs');

    try {
      cycleLogger.info('reconciliation_started', { reconciliationId });

      // 1. Fetch fresh quotas from QuotaService (incorporating fresh usage from UsageService)
      let quotas: DeviceQuota[] = [];
      try {
        quotas = await this.circuitBreaker.execute(() =>
          this.retryPolicy.execute(() => this.quotaService.refreshAllQuotas())
        );
      } catch (err: unknown) {
        const classified = classifyError(err);
        if (classified.category === 'SSH_FAILURE') {
          this.metrics.increment('ssh_failures');
        }
        this.metrics.increment('reconciliation_failures');

        const errMsg = this.sanitizeErrorMessage(err);
        this.logger.error(`Failed to refresh quotas from router: ${errMsg}`);
        cycleLogger.error('operation_failed', {
          reconciliationId,
          event: 'quota_refresh_failed',
          category: classified.category,
          error: errMsg,
        });

        const durationMs = Date.now() - startTime;
        const isoNow = new Date().toISOString();
        this.lastCompletedAt = isoNow;
        this.lastFailureAt = isoNow;
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
          reconciliationId,
        };
      }

      // 2. Ensure dedicated nftables ruleset is provisioned (handles firewall state loss / reboot)
      if (typeof this.firewallService.ensureRuleset === 'function') {
        try {
          this.metrics.increment('firewall_operations');
          await this.circuitBreaker.execute(() =>
            this.retryPolicy.execute(() => this.firewallService.ensureRuleset())
          );
          this.metrics.increment('recovery_actions');
        } catch (rulesetErr: unknown) {
          const classified = classifyError(rulesetErr);
          if (classified.category === 'SSH_FAILURE') {
            this.metrics.increment('ssh_failures');
          }
          this.metrics.increment('firewall_operation_failures');
          const errMsg = this.sanitizeErrorMessage(rulesetErr);
          this.logger.warn(`Failed to verify or initialize firewall ruleset: ${errMsg}`);
          cycleLogger.warn('firewall_ruleset_warning', {
            reconciliationId,
            error: errMsg,
            category: classified.category,
          });
        }
      }

      // Reconcile manual blocks if router state was lost/rebooted
      if (typeof (this.firewallService as { reconcileManualBlocks?: () => Promise<void> }).reconcileManualBlocks === 'function') {
        try {
          this.metrics.increment('firewall_operations');
          await this.circuitBreaker.execute(() =>
            this.retryPolicy.execute(() =>
              (this.firewallService as { reconcileManualBlocks: () => Promise<void> }).reconcileManualBlocks()
            )
          );
          this.metrics.increment('manual_blocks_restored');
        } catch (manualErr: unknown) {
          const errMsg = this.sanitizeErrorMessage(manualErr);
          this.logger.warn(`Failed to reconcile manual firewall blocks: ${errMsg}`);
          cycleLogger.warn('manual_reconcile_warning', { reconciliationId, error: errMsg });
        }
      }

      // 3. Fetch actual blocked MACs from firewall (inspecting table inet quota_enforcement set blocked_macs)
      let actualBlockedList: string[] = [];
      try {
        this.metrics.increment('firewall_operations');
        actualBlockedList = typeof this.firewallService.getQuotaBlockedDevices === 'function'
          ? await this.circuitBreaker.execute(() =>
              this.retryPolicy.execute(() => this.firewallService.getQuotaBlockedDevices!())
            )
          : await this.circuitBreaker.execute(() =>
              this.retryPolicy.execute(() => this.firewallService.getBlockedDevices())
            );
      } catch (err: unknown) {
        const classified = classifyError(err);
        if (classified.category === 'SSH_FAILURE') {
          this.metrics.increment('ssh_failures');
        }
        this.metrics.increment('firewall_operation_failures');
        this.metrics.increment('reconciliation_failures');

        const errMsg = this.sanitizeErrorMessage(err);
        this.logger.error(`Failed to retrieve actual blocked devices from firewall: ${errMsg}`);
        cycleLogger.error('operation_failed', {
          reconciliationId,
          event: 'firewall_fetch_failed',
          category: classified.category,
          error: errMsg,
        });

        const durationMs = Date.now() - startTime;
        const isoNow = new Date().toISOString();
        this.lastCompletedAt = isoNow;
        this.lastFailureAt = isoNow;
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
          reconciliationId,
        };
      }

      const actualBlockedSet = new Set(actualBlockedList.map((m) => m.toUpperCase()));

      // 4. Determine desired blocked state from QuotaService
      const desiredBlockedSet = new Set<string>();
      const quotaMap = new Map<string, DeviceQuota>();

      for (const quota of quotas) {
        const normMac = quota.mac.toUpperCase();
        quotaMap.set(normMac, quota);
        if (quota.status === 'exhausted' || quota.usedBytes >= quota.quotaBytes) {
          desiredBlockedSet.add(normMac);
        }
      }

      this.metrics.increment('quota_devices_evaluated', quotas.length);
      this.metrics.increment('quota_devices_exhausted', desiredBlockedSet.size);

      let reconciliationStartedLogged = false;
      const logReconciliationStarted = () => {
        if (!reconciliationStartedLogged) {
          this.logger.info('Reconciliation started');
          reconciliationStartedLogged = true;
        }
      };

      if (this.isInitialRun) {
        logReconciliationStarted();
        this.logger.info(`Desired blocked devices: ${desiredBlockedSet.size}`);
        this.logger.info(`Actual blocked devices: ${actualBlockedSet.size}`);
      }

      let blockedCount = 0;
      let unblockedCount = 0;
      let unchangedCount = 0;
      let errorCount = 0;
      const results: EnforcementCycleResult['results'] = [];
      const evaluatedMacs = new Set<string>();

      // 5. Evaluate each configured device quota
      for (const quota of quotas) {
        const mac = quota.mac.toUpperCase();
        evaluatedMacs.add(mac);

        try {
          const isDesiredBlocked = desiredBlockedSet.has(mac);
          const isActuallyBlocked = actualBlockedSet.has(mac);

          if (isDesiredBlocked) {
            // DESIRED: BLOCKED (quota is exhausted)
            cycleLogger.info('quota_exhausted', {
              reconciliationId,
              mac,
              usedBytes: quota.usedBytes,
              quotaBytes: quota.quotaBytes,
            });

            const isQuotaRecorded = await this.firewallService.isBlocked(mac, 'quota');

            if (isActuallyBlocked) {
              if (!isQuotaRecorded) {
                this.metrics.increment('firewall_operations');
                await this.circuitBreaker.execute(() =>
                  this.retryPolicy.execute(() => this.firewallService.blockDevice(mac, 'quota'))
                );
              }
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
              // MISSING BLOCK: (Newly exhausted or router rebooted with cleared nftables set)
              logReconciliationStarted();
              this.logger.info(`Quota exhausted, firewall block required: ${mac}`);
              this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=blocked actual=unblocked action=block`);

              this.metrics.increment('firewall_operations');
              await this.circuitBreaker.execute(() =>
                this.retryPolicy.execute(() => this.firewallService.blockDevice(mac, 'quota'))
              );
              this.enforcementState.set(mac, 'blocked');

              this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=blocked actual=unblocked action=block result=success`);
              cycleLogger.info('device_blocked', {
                reconciliationId,
                mac,
                source: 'quota',
                usedBytes: quota.usedBytes,
                quotaBytes: quota.quotaBytes,
              });

              this.metrics.increment('devices_blocked');
              this.metrics.increment('recovery_actions');
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
                // Manual admin block protection: remove quota ownership, manual block remains
                if (isQuotaRecorded) {
                  logReconciliationStarted();
                  this.logger.info(`Preserving manual block: ${mac}`);
                  this.metrics.increment('firewall_operations');
                  await this.circuitBreaker.execute(() =>
                    this.retryPolicy.execute(() => this.firewallService.unblockDevice(mac, 'quota'))
                  );
                  this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=unblocked actual=blocked action=preserve reason="manual_block_protected"`);
                  cycleLogger.info('manual_block_protected', { reconciliationId, mac });
                }
                this.enforcementState.set(mac, 'unblocked');
                unchangedCount++;
                results.push({
                  mac,
                  action: 'none',
                  quotaStatus: 'active',
                  success: true,
                  reason: 'Active quota; device remains blocked by manual administrator block',
                });
              } else {
                // STALE BLOCK: Quota is active; unblock device
                logReconciliationStarted();
                this.logger.info(`Stale quota block removed: ${mac}`);
                this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=unblocked actual=blocked action=unblock`);

                this.metrics.increment('firewall_operations');
                await this.circuitBreaker.execute(() =>
                  this.retryPolicy.execute(() => this.firewallService.unblockDevice(mac, 'quota'))
                );
                this.enforcementState.set(mac, 'unblocked');

                this.logger.info(`[QuotaReconciliation] MAC=${mac} desired=unblocked actual=blocked action=unblock result=success`);
                cycleLogger.info('device_unblocked', { reconciliationId, mac, source: 'quota' });

                this.metrics.increment('devices_unblocked');
                this.metrics.increment('recovery_actions');
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
              this.enforcementState.set(mac, 'unblocked');
              unchangedCount++;
              results.push({
                mac,
                action: 'none',
                quotaStatus: 'active',
                success: true,
                reason: isActuallyBlocked
                  ? 'Active quota; device remains blocked by manual administrator block'
                  : 'Device is active and unblocked',
              });
            }
          }
        } catch (devErr: unknown) {
          errorCount++;
          logReconciliationStarted();
          const classified = classifyError(devErr);
          if (classified.category === 'SSH_FAILURE') {
            this.metrics.increment('ssh_failures');
          }
          this.metrics.increment('firewall_operation_failures');

          const errMsg = this.sanitizeErrorMessage(devErr);
          const actionStr = desiredBlockedSet.has(mac) ? 'block' : 'unblock';
          const desiredStr = desiredBlockedSet.has(mac) ? 'blocked' : 'unblocked';
          const actualStr = actualBlockedSet.has(mac) ? 'blocked' : 'unblocked';

          this.logger.error(`Device reconciliation failed for ${mac}: ${errMsg}`);
          this.logger.error(
            `[QuotaReconciliation] MAC=${mac} desired=${desiredStr} actual=${actualStr} action=${actionStr} result=error error="${errMsg}"`
          );
          cycleLogger.error('operation_failed', {
            reconciliationId,
            mac,
            category: classified.category,
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

      // 6. Reconcile stale blocks in nftables for deleted quotas or orphan blocks
      for (const blockedMac of actualBlockedSet) {
        if (evaluatedMacs.has(blockedMac)) {
          continue;
        }
        evaluatedMacs.add(blockedMac);

        try {
          const isManual = await this.firewallService.isBlocked(blockedMac, 'manual');
          const isQuota = await this.firewallService.isBlocked(blockedMac, 'quota');
          if (isManual) {
            if (isQuota) {
              this.metrics.increment('firewall_operations');
              await this.circuitBreaker.execute(() =>
                this.retryPolicy.execute(() => this.firewallService.unblockDevice(blockedMac, 'quota'))
              );
            }
            continue;
          }

          // Device has no configured quota, is in nftables, and is NOT manually blocked
          this.metrics.increment('orphan_blocks_detected');
          logReconciliationStarted();
          this.logger.info(`Stale quota block removed: ${blockedMac}`);
          this.logger.info(`[QuotaReconciliation] MAC=${blockedMac} desired=unblocked actual=blocked action=unblock`);

          this.metrics.increment('firewall_operations');
          await this.circuitBreaker.execute(() =>
            this.retryPolicy.execute(() => this.firewallService.unblockDevice(blockedMac, 'quota'))
          );
          this.enforcementState.delete(blockedMac);

          this.logger.info(`[QuotaReconciliation] MAC=${blockedMac} desired=unblocked actual=blocked action=unblock result=success`);
          cycleLogger.info('orphan_block_removed', { reconciliationId, mac: blockedMac });

          this.metrics.increment('orphan_blocks_removed');
          this.metrics.increment('devices_unblocked');
          this.metrics.increment('recovery_actions');
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
          logReconciliationStarted();
          const classified = classifyError(err);
          if (classified.category === 'SSH_FAILURE') {
            this.metrics.increment('ssh_failures');
          }
          this.metrics.increment('firewall_operation_failures');

          const errMsg = this.sanitizeErrorMessage(err);
          this.logger.error(`Device reconciliation failed for ${blockedMac}: ${errMsg}`);
          this.logger.error(
            `[QuotaReconciliation] MAC=${blockedMac} desired=unblocked actual=blocked action=unblock result=error error="${errMsg}"`
          );
          cycleLogger.error('operation_failed', {
            reconciliationId,
            mac: blockedMac,
            category: classified.category,
            error: errMsg,
          });

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

      // 7. Clean up any stale quota block repository ownership for MACs without quotas
      try {
        const repoQuotaBlocked = typeof (this.firewallService as { getRepositoryBlockedDevices?: (s?: string) => Promise<string[]> }).getRepositoryBlockedDevices === 'function'
          ? await (this.firewallService as { getRepositoryBlockedDevices: (s?: string) => Promise<string[]> }).getRepositoryBlockedDevices('quota')
          : (typeof this.firewallService.getBlockedDevices === 'function'
              ? await this.firewallService.getBlockedDevices('quota')
              : []);
        for (const repoMac of repoQuotaBlocked) {
          const norm = repoMac.toUpperCase();
          if (!desiredBlockedSet.has(norm) && !quotaMap.has(norm)) {
            await this.firewallService.unblockDevice(norm, 'quota');
          }
        }
      } catch {
        // Safe no-op if source listing is unsupported
      }

      // 8. Clean up in-memory state entries for MACs that no longer exist anywhere
      for (const cachedMac of Array.from(this.enforcementState.keys())) {
        if (!quotaMap.has(cachedMac) && !actualBlockedSet.has(cachedMac)) {
          this.enforcementState.delete(cachedMac);
        }
      }

      if (blockedCount > 0 || unblockedCount > 0) {
        this.logger.info(`Firewall state reconciled (${blockedCount} blocked, ${unblockedCount} unblocked, ${unchangedCount} unchanged)`);
      } else if (this.isInitialRun) {
        this.logger.info(`Firewall state reconciled (initial: ${quotas.length} evaluated, 0 changes required)`);
      } else if (errorCount > 0) {
        this.logger.error(`Reconciliation completed with ${errorCount} error(s)`);
      } else {
        this.logger.debug?.('Reconciliation completed with no changes');
      }

      this.isInitialRun = false;

      const durationMs = Date.now() - startTime;
      const cycleSuccess = errorCount === 0;
      const isoNow = new Date().toISOString();
      this.lastCompletedAt = isoNow;

      if (cycleSuccess) {
        this.lastSuccessfulAt = isoNow;
        this.metrics.increment('reconciliation_successes');
      } else {
        this.lastFailureAt = isoNow;
        this.metrics.increment('reconciliation_failures');
      }

      this.devicesEvaluated = quotas.length;
      this.devicesBlocked = blockedCount;
      this.devicesUnblocked = unblockedCount;

      cycleLogger.info('reconciliation_completed', {
        reconciliationId,
        durationMs,
        blockedCount,
        unblockedCount,
        unchangedCount,
        errorCount,
        success: cycleSuccess,
      });

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
        reconciliationId,
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
    this.isInitialRun = true;
  }

  /**
   * Returns current monitor telemetry and health status.
   */
  public getStatus(): EnforcementMonitorStatus {
    return {
      running: this.running,
      syncInProgress: this.isSyncing,
      intervalMs: this.intervalMs,
      enabled: this.enabled,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastSuccessfulAt: this.lastSuccessfulAt,
      lastFailureAt: this.lastFailureAt,
      lastDurationMs: this.lastRunDurationMs,
      devicesEvaluated: this.devicesEvaluated,
      devicesBlocked: this.devicesBlocked,
      devicesUnblocked: this.devicesUnblocked,
      reconciliationId: this.currentReconciliationId,
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

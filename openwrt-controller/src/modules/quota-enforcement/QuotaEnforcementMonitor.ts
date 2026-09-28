import { env } from '../../config/env.js';
import {
  QuotaEnforcementService,
  quotaEnforcementService as defaultService,
  type IEnforcementLogger,
} from './QuotaEnforcementService.js';
import type {
  EnforcementCycleResult,
  EnforcementMonitorStatus,
} from './types.js';

const defaultLogger: IEnforcementLogger = {
  info: (msg, ...args) => console.log(`[QuotaEnforcementMonitor] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[QuotaEnforcementMonitor] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[QuotaEnforcementMonitor] ${msg}`, ...args),
};

export interface QuotaEnforcementMonitorOptions {
  intervalMs?: number;
  logger?: IEnforcementLogger;
}

/**
 * Production Quota Enforcement Background Monitor.
 *
 * Responsibilities:
 * - Manages the periodic background enforcement timer.
 * - Prevents overlapping executions using an active cycle lock.
 * - Executes an immediate initial cycle upon start().
 * - Ensures lifecycle safety (idempotent start/stop, no duplicate timers).
 * - Tracks telemetry for health monitoring (last run timestamp, duration, error state).
 * - Does NOT contain quota calculation or firewall business logic.
 */
export class QuotaEnforcementMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isRunningCycle = false;
  private running = false;
  private readonly intervalMs: number;
  private readonly logger: IEnforcementLogger;

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

  constructor(
    private readonly service: QuotaEnforcementService = defaultService,
    options: QuotaEnforcementMonitorOptions = {}
  ) {
    this.intervalMs = Math.max(
      1000,
      options.intervalMs ?? env.QUOTA_ENFORCEMENT_INTERVAL_MS ?? 10000
    );
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Starts periodic quota enforcement.
   * Calling start() multiple times is safe and will not create duplicate timers.
   * Executes the first enforcement cycle immediately.
   */
  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.logger.info(`Started Quota Enforcement Monitor (interval: ${this.intervalMs}ms)`);

    // 1. Run first cycle immediately
    void this.runCycle();

    // 2. Schedule periodic timer
    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.intervalMs);

    // Unref timer so it does not block clean Node process exit
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops periodic quota enforcement.
   * Safe to call multiple times. Supports waiting for active cycle.
   */
  public async stop(options?: { waitForCycle?: boolean; timeoutMs?: number }): Promise<void> {
    if (!this.running && this.timer === null && !this.isRunningCycle) {
      return;
    }

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (options?.waitForCycle && this.isRunningCycle) {
      const timeout = options.timeoutMs ?? 3000;
      const start = Date.now();
      while (this.isRunningCycle && Date.now() - start < timeout) {
        await new Promise((r) => setTimeout(r, 50));
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

  /**
   * Runs a single enforcement cycle.
   * Protected by an execution lock to prevent overlapping runs when operations take longer than interval.
   */
  public async runCycle(): Promise<EnforcementCycleResult | null> {
    // If not running (e.g. stopped right after interval fired), skip
    if (!this.running && this.timer !== null) {
      return null;
    }

    // Execution lock: prevent overlapping runs
    if (this.isRunningCycle) {
      this.logger.warn('Previous enforcement cycle is still in progress; skipping this interval');
      return null;
    }

    this.isRunningCycle = true;
    const startMs = Date.now();
    this.lastStartedAt = new Date().toISOString();

    try {
      const result = await this.service.enforceAll();

      this.lastCompletedAt = new Date().toISOString();
      this.lastRunAt = result.timestamp;
      this.lastRunDurationMs = result.durationMs;
      this.lastRunSuccess = result.success;
      this.totalRuns++;
      this.devicesEvaluated = result.totalEvaluated;
      this.devicesBlocked = result.blockedCount;
      this.devicesUnblocked = result.unblockedCount;

      if (result.success) {
        this.lastError = null;
        this.consecutiveErrors = 0;
        this.lastSuccessfulAt = result.timestamp;
      } else {
        this.lastError = result.error ?? 'Enforcement cycle reported errors';
        this.consecutiveErrors++;
        this.lastFailureAt = result.timestamp;
      }

      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isoNow = new Date().toISOString();

      this.lastCompletedAt = isoNow;
      this.lastRunAt = isoNow;
      this.lastRunDurationMs = durationMs;
      this.lastRunSuccess = false;
      this.lastError = errMsg;
      this.lastFailureAt = isoNow;
      this.totalRuns++;
      this.consecutiveErrors++;

      this.logger.error(`Unhandled error during enforcement cycle: ${errMsg}`);
      return null;
    } finally {
      this.isRunningCycle = false;
    }
  }

  /**
   * Returns current monitor telemetry and health status.
   */
  public getStatus(): EnforcementMonitorStatus {
    return {
      running: this.running,
      syncInProgress: this.isRunningCycle,
      intervalMs: this.intervalMs,
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastSuccessfulAt: this.lastSuccessfulAt,
      lastFailureAt: this.lastFailureAt,
      lastDurationMs: this.lastRunDurationMs,
      lastRunAt: this.lastRunAt,
      lastRunDurationMs: this.lastRunDurationMs,
      lastRunSuccess: this.lastRunSuccess,
      lastError: this.lastError,
      totalRuns: this.totalRuns,
      consecutiveErrors: this.consecutiveErrors,
      devicesEvaluated: this.devicesEvaluated,
      devicesBlocked: this.devicesBlocked,
      devicesUnblocked: this.devicesUnblocked,
    };
  }
}

export const quotaEnforcementMonitor = new QuotaEnforcementMonitor();

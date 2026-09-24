import { QuotaService, quotaService as defaultQuotaService } from '../quota/QuotaService.js';
import { FirewallService, firewallService as defaultFirewallService } from '../firewall/FirewallService.js';
import type { DeviceQuota } from '../quota/types.js';
import type {
  DeviceEnforcementResult,
  EnforcementCycleResult,
} from './types.js';

export interface IEnforcementLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug?(msg: string, ...args: unknown[]): void;
}

const defaultLogger: IEnforcementLogger = {
  info: (msg, ...args) => console.log(`[QuotaEnforcementService] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[QuotaEnforcementService] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[QuotaEnforcementService] ${msg}`, ...args),
};

/**
 * Production-ready Quota Enforcement Service.
 *
 * Responsibilities:
 * - Obtains authoritative quota telemetry from QuotaService.
 * - Evaluates device quota state against firewall state.
 * - Strictly enforces block ownership: only blocks or removes blocks owned by quota enforcement.
 * - Protects manually created administrator firewall blocks from inadvertent removal.
 * - Guarantees error isolation: failures on one device never interrupt enforcement for others.
 * - Handles router/network outages gracefully without marking devices as exhausted.
 */
export class QuotaEnforcementService {
  constructor(
    private readonly quotaService: QuotaService = defaultQuotaService,
    private readonly firewallService: FirewallService = defaultFirewallService,
    private readonly logger: IEnforcementLogger = defaultLogger
  ) {}

  /**
   * Evaluates a single device quota record and applies firewall adjustments if necessary.
   * Idempotent and safe to run on every cycle.
   */
  public async evaluateQuota(quota: DeviceQuota): Promise<DeviceEnforcementResult> {
    const mac = quota.mac;

    if (quota.status === 'exhausted') {
      const isQuotaBlocked = await this.firewallService.isBlocked(mac, 'quota');
      const isActuallyBlockedInNft = await this.firewallService.isBlocked(mac);

      // If already marked as quota-blocked and present in firewall, no-op to avoid duplicate SSH calls
      if (isQuotaBlocked && isActuallyBlockedInNft) {
        return {
          mac,
          action: 'none',
          quotaStatus: 'exhausted',
          success: true,
          reason: 'Already blocked by quota enforcement',
        };
      }

      // Quota limit exhausted: block the device
      this.logger.info(
        `Quota exhausted for ${mac} (used=${quota.usedBytes}, quota=${quota.quotaBytes}) -> blocking device`
      );

      await this.firewallService.blockDevice(mac, 'quota');

      return {
        mac,
        action: 'blocked',
        quotaStatus: 'exhausted',
        success: true,
        reason: 'Device exceeded quota and was blocked',
      };
    }

    if (quota.status === 'active') {
      const isQuotaBlocked = await this.firewallService.isBlocked(mac, 'quota');

      if (isQuotaBlocked) {
        // Quota is active and this device was previously blocked by quota enforcement
        this.logger.info(
          `Quota became active for ${mac} (used=${quota.usedBytes}, quota=${quota.quotaBytes}) -> removing quota-enforced block`
        );

        await this.firewallService.unblockDevice(mac, 'quota');

        return {
          mac,
          action: 'unblocked',
          quotaStatus: 'active',
          success: true,
          reason: 'Quota is active; removed quota-enforced block',
        };
      }

      // Device is active and not blocked by quota enforcement.
      // If a manual admin block exists, it is untouched.
      return {
        mac,
        action: 'none',
        quotaStatus: 'active',
        success: true,
        reason: 'Device is active and not quota-blocked',
      };
    }

    return {
      mac,
      action: 'none',
      quotaStatus: quota.status,
      success: true,
      reason: `Unknown quota status: ${String(quota.status)}`,
    };
  }

  /**
   * Refreshes all quotas and enforces the desired firewall state across all devices.
   * Isolates errors so that individual device failures do not stop the cycle.
   */
  public async enforceAll(): Promise<EnforcementCycleResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    let quotas: DeviceQuota[] = [];
    try {
      quotas = await this.quotaService.refreshAllQuotas();
    } catch (err: unknown) {
      const errMsg = this.sanitizeErrorMessage(err);
      this.logger.error(`Failed to refresh quotas from router: ${errMsg}`);

      return {
        timestamp,
        durationMs: Date.now() - startTime,
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

    let blockedCount = 0;
    let unblockedCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;
    const results: DeviceEnforcementResult[] = [];

    for (const quota of quotas) {
      try {
        const result = await this.evaluateQuota(quota);
        results.push(result);

        if (result.action === 'blocked') {
          blockedCount++;
        } else if (result.action === 'unblocked') {
          unblockedCount++;
        } else {
          unchangedCount++;
        }
      } catch (devErr: unknown) {
        errorCount++;
        const errMsg = this.sanitizeErrorMessage(devErr);
        this.logger.error(`Error enforcing quota for MAC ${quota.mac}: ${errMsg}`);

        results.push({
          mac: quota.mac,
          action: 'none',
          quotaStatus: quota.status,
          success: false,
          error: errMsg,
        });
        // Continue processing remaining devices (Error Isolation requirement)
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      timestamp,
      durationMs,
      totalEvaluated: quotas.length,
      blockedCount,
      unblockedCount,
      unchangedCount,
      errorCount,
      results,
      success: errorCount === 0,
      error: errorCount > 0 ? `${errorCount} device enforcement error(s) occurred` : undefined,
    };
  }

  /**
   * Sanitizes error messages to protect sensitive router credentials or keys.
   */
  private sanitizeErrorMessage(err: unknown): string {
    if (!err) return 'Unknown error';
    let msg = err instanceof Error ? err.message : String(err);
    // Redact password or key path if present in message
    msg = msg.replace(/(password|token|secret)=[^&\s]+/gi, '$1=[REDACTED]');
    return msg;
  }
}

export const quotaEnforcementService = new QuotaEnforcementService();

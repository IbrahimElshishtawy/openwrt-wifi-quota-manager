import type { HealthReport, SystemHealthStatus, SubsystemHealth, ReconciliationHealth } from './types.js';
import { CircuitBreaker, circuitBreaker as defaultCircuitBreaker } from '../../infrastructure/resilience/CircuitBreaker.js';
import { type IQuotaRepository } from '../quota/storage/IQuotaRepository.js';
import { quotaRepository as defaultQuotaRepository } from '../quota/storage/FileQuotaRepository.js';
import type { IQuotaEnforcementMonitor, EnforcementMonitorStatus } from '../quota/QuotaEnforcementMonitor.js';
import { quotaEnforcementMonitor as defaultMonitor } from '../quota/QuotaEnforcementMonitor.js';

export interface HealthServiceDependencies {
  circuitBreaker?: CircuitBreaker;
  quotaRepository?: IQuotaRepository;
  monitor?: IQuotaEnforcementMonitor & { getStatus(): EnforcementMonitorStatus };
}

export class HealthService {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly quotaRepository: IQuotaRepository;
  private readonly monitor: (IQuotaEnforcementMonitor & { getStatus(): EnforcementMonitorStatus }) | null;

  constructor(deps: HealthServiceDependencies = {}) {
    this.circuitBreaker = deps.circuitBreaker ?? defaultCircuitBreaker;
    this.quotaRepository = deps.quotaRepository ?? defaultQuotaRepository;
    this.monitor = deps.monitor ?? (defaultMonitor as unknown as (IQuotaEnforcementMonitor & { getStatus(): EnforcementMonitorStatus }));
  }

  public async getHealth(): Promise<HealthReport> {
    const timestamp = new Date().toISOString();
    const uptimeSeconds = Math.floor(process.uptime());

    // 1. Evaluate Quota Storage Subsystem
    const quotaHealth = await this.evaluateQuotaHealth();

    // 2. Evaluate Firewall & Router Subsystem
    const firewallHealth = this.evaluateFirewallHealth();

    // 3. Evaluate Reconciliation Monitor Subsystem
    const reconciliationHealth = this.evaluateReconciliationHealth();

    // 4. Overall status calculation
    let overallStatus: SystemHealthStatus = 'healthy';
    if (
      quotaHealth.status === 'unhealthy' ||
      firewallHealth.status === 'unhealthy' ||
      reconciliationHealth.status === 'unhealthy'
    ) {
      overallStatus = 'unhealthy';
    } else if (
      quotaHealth.status === 'degraded' ||
      firewallHealth.status === 'degraded' ||
      reconciliationHealth.status === 'degraded'
    ) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      service: 'openwrt-controller',
      timestamp,
      uptimeSeconds,
      firewall: firewallHealth,
      quota: quotaHealth,
      reconciliation: reconciliationHealth,
    };
  }

  private async evaluateQuotaHealth(): Promise<SubsystemHealth> {
    try {
      await this.quotaRepository.getAll();
      return { status: 'healthy' };
    } catch (err: unknown) {
      return {
        status: 'unhealthy',
        details: err instanceof Error ? err.message : 'Quota storage inaccessible',
      };
    }
  }

  private evaluateFirewallHealth(): SubsystemHealth {
    const cbState = this.circuitBreaker.getState();
    const diags = this.circuitBreaker.getDiagnostics();

    if (cbState === 'OPEN') {
      return {
        status: diags.consecutiveFailures >= 5 ? 'unhealthy' : 'degraded',
        circuitBreaker: 'OPEN',
        details: 'OpenWrt router connection is currently failing; circuit breaker is OPEN',
      };
    }

    if (cbState === 'HALF_OPEN') {
      return {
        status: 'degraded',
        circuitBreaker: 'HALF_OPEN',
        details: 'Circuit breaker is in HALF_OPEN recovery probing state',
      };
    }

    return {
      status: 'healthy',
      circuitBreaker: 'CLOSED',
    };
  }

  private evaluateReconciliationHealth(): ReconciliationHealth {
    if (!this.monitor) {
      return {
        status: 'healthy',
        lastSuccessAt: null,
        lastDurationMs: null,
      };
    }

    const status = this.monitor.getStatus();
    const consecutiveErrors = status.consecutiveErrors ?? 0;
    const lastSuccessAt = (status as { lastSuccessfulAt?: string | null }).lastSuccessfulAt ??
      (status.lastRunSuccess ? status.lastRunAt : null);
    const lastDurationMs = (status as { lastDurationMs?: number | null }).lastDurationMs ??
      status.lastRunDurationMs;

    let subStatus: SystemHealthStatus = 'healthy';
    let details: string | undefined;

    if (consecutiveErrors >= 5) {
      subStatus = 'unhealthy';
      details = `Reconciliation failing repeatedly (${consecutiveErrors} consecutive errors): ${status.lastError ?? 'Unknown error'}`;
    } else if (consecutiveErrors >= 1 || this.circuitBreaker.isOpen()) {
      subStatus = 'degraded';
      details = status.lastError ?? (this.circuitBreaker.isOpen() ? 'Router operations paused by circuit breaker' : undefined);
    }

    return {
      status: subStatus,
      lastSuccessAt,
      lastDurationMs,
      consecutiveErrors,
      ...(details ? { details } : {}),
    };
  }
}

export const healthService = new HealthService();

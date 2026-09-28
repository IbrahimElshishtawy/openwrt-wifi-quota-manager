import type {
  HealthReport,
  SystemHealthStatus,
  SubsystemHealth,
  ReconciliationHealth,
  LivenessReport,
  ReadinessReport,
  ReadinessStatus,
} from './types.js';
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

  /**
   * Comprehensive health check evaluating all controller subsystems.
   * Backward compatible with Phase 16 & 17 tests.
   */
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

    const routerStatus: SystemHealthStatus =
      firewallHealth.status === 'unhealthy' ? 'unhealthy' :
      firewallHealth.status === 'degraded' ? 'degraded' : 'healthy';

    const monitorState =
      this.monitor
        ? typeof (this.monitor as { isRunning?: () => boolean }).isRunning === 'function' &&
          (this.monitor as { isRunning: () => boolean }).isRunning()
          ? 'running'
          : 'stopped'
        : 'disabled';

    return {
      status: overallStatus,
      service: 'openwrt-controller',
      timestamp,
      uptimeSeconds,
      router: routerStatus,
      firewall: firewallHealth,
      quota: quotaHealth,
      reconciliation: reconciliationHealth,
      monitor: monitorState,
    };
  }

  /**
   * Liveness probe: evaluates if the Node.js process is active, responsive,
   * and the event loop is functioning.
   */
  public getLiveness(): LivenessReport {
    const mem = process.memoryUsage();
    return {
      status: 'alive',
      service: 'openwrt-controller',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      memoryUsage: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
      },
    };
  }

  /**
   * Readiness probe: evaluates if the controller is ready to process traffic
   * and perform management operations.
   */
  public async getReadiness(): Promise<ReadinessReport> {
    const timestamp = new Date().toISOString();
    const uptimeSeconds = Math.floor(process.uptime());
    const degradedReasons: string[] = [];

    // 1. Quota Storage (Critical dependency)
    let quotaReady = true;
    let quotaDetails: string | undefined;
    let quotaSubStatus: SystemHealthStatus = 'healthy';
    try {
      await this.quotaRepository.getAll();
    } catch (err: unknown) {
      quotaReady = false;
      quotaSubStatus = 'unhealthy';
      quotaDetails = err instanceof Error ? err.message : 'Quota storage inaccessible';
      degradedReasons.push(`Critical: Quota storage inaccessible (${quotaDetails})`);
    }

    // 2. OpenWrt Router Connectivity via Circuit Breaker
    const cbState = this.circuitBreaker.getState();
    const cbDiags = this.circuitBreaker.getDiagnostics();
    let routerReady = true;
    let routerDetails: string | undefined;

    if (cbState === 'OPEN') {
      if (cbDiags.consecutiveFailures >= 10) {
        routerReady = false;
        routerDetails = `Router connectivity failing repeatedly (${cbDiags.consecutiveFailures} failures)`;
        degradedReasons.push(routerDetails);
      } else {
        routerDetails = `Router circuit breaker is OPEN (${cbDiags.consecutiveFailures} failures, cooldown active)`;
        degradedReasons.push(routerDetails);
      }
    } else if (cbState === 'HALF_OPEN') {
      routerDetails = 'Circuit breaker probing router in HALF_OPEN recovery state';
      degradedReasons.push(routerDetails);
    }

    // 3. Firewall Subsystem
    const firewallReady = routerReady;
    const firewallDetails = routerDetails;

    // 4. Quota Enforcement Monitor
    let monitorReady = true;
    let monitorStateStr = 'disabled';
    let monitorDetails: string | undefined;

    if (this.monitor) {
      const isRunning = typeof (this.monitor as { isRunning?: () => boolean }).isRunning === 'function' &&
        (this.monitor as { isRunning: () => boolean }).isRunning();
      monitorStateStr = isRunning ? 'running' : 'stopped';

      const monStatus = typeof this.monitor.getStatus === 'function' ? this.monitor.getStatus() : null;
      if (monStatus && (monStatus.consecutiveErrors ?? 0) >= 5) {
        monitorDetails = `Monitor failing consecutive cycles (${monStatus.consecutiveErrors} errors)`;
        degradedReasons.push(monitorDetails);
      }
    }

    // Determine overall readiness
    let status: ReadinessStatus = 'ready';
    let isReady = true;

    if (!quotaReady || (!routerReady && cbDiags.consecutiveFailures >= 10)) {
      status = 'not_ready';
      isReady = false;
    } else if (degradedReasons.length > 0) {
      status = 'degraded';
      isReady = true;
    }

    return {
      status,
      service: 'openwrt-controller',
      timestamp,
      uptimeSeconds,
      ready: isReady,
      subsystems: {
        quotaStorage: {
          ready: quotaReady,
          status: quotaSubStatus,
          details: quotaDetails,
        },
        routerConnectivity: {
          ready: routerReady,
          circuitBreaker: cbState,
          consecutiveFailures: cbDiags.consecutiveFailures,
          details: routerDetails,
        },
        firewall: {
          ready: firewallReady,
          details: firewallDetails,
        },
        monitor: {
          ready: monitorReady,
          state: monitorStateStr,
          details: monitorDetails,
        },
      },
      ...(degradedReasons.length > 0 ? { degradedReasons } : {}),
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

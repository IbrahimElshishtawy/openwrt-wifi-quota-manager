import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import { circuitBreaker as defaultCircuitBreaker, CircuitBreaker } from '../../infrastructure/resilience/CircuitBreaker.js';
import { metricsService as defaultMetricsService, MetricsService } from '../../infrastructure/metrics/MetricsService.js';
import { quotaEnforcementMonitor as defaultMonitor, QuotaEnforcementMonitor } from '../quota/QuotaEnforcementMonitor.js';
import { healthService as defaultHealthService, HealthService } from '../health/HealthService.js';

export interface OperationsControllerDependencies {
  circuitBreaker?: CircuitBreaker;
  metricsService?: MetricsService;
  monitor?: QuotaEnforcementMonitor;
  healthService?: HealthService;
}

export interface OperationalStatusResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  controllerVersion: string;
  nodeEnv: string;
  openwrt: {
    host: string;
    port: number;
    circuitBreaker: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
    consecutiveFailures: number;
    lastFailureTime: string | null;
    lastSuccessTime: string | null;
  };
  monitor: {
    running: boolean;
    syncInProgress: boolean;
    intervalMs: number;
    enabled: boolean;
    lastRunAt: string | null;
    lastRunDurationMs: number | null;
    lastRunSuccess: boolean | null;
    totalRuns: number;
    consecutiveErrors: number;
  };
  lastEnforcement: {
    reconciliationId: string | null;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastSuccessfulAt: string | null;
    lastFailureAt: string | null;
    durationMs: number | null;
    devicesEvaluated: number;
    devicesBlocked: number;
    devicesUnblocked: number;
    success: boolean | null;
  };
  lastReconciliation: {
    timestamp: string | null;
    success: boolean | null;
    reconciliationId: string | null;
  };
  metricsSummary: {
    httpRequestsTotal: number;
    httpErrorsTotal: number;
    sshAttempts: number;
    sshFailures: number;
    enforcementCycles: number;
    circuitBreakerOpens: number;
    devicesBlockedTotal: number;
    devicesUnblockedTotal: number;
  };
  degradedComponents: string[];
}

export class OperationsController {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly metrics: MetricsService;
  private readonly monitor: QuotaEnforcementMonitor;
  private readonly health: HealthService;

  constructor(deps: OperationsControllerDependencies = {}) {
    this.circuitBreaker = deps.circuitBreaker ?? defaultCircuitBreaker;
    this.metrics = deps.metricsService ?? defaultMetricsService;
    this.monitor = deps.monitor ?? defaultMonitor;
    this.health = deps.healthService ?? defaultHealthService;
  }

  public getStatus = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const timestamp = new Date().toISOString();
    const uptimeSeconds = Math.floor(process.uptime());

    const cbDiags = this.circuitBreaker.getDiagnostics();
    const monitorStatus = this.monitor.getStatus();
    const healthReport = await this.health.getHealth();

    const degradedComponents: string[] = [];
    if (healthReport.router === 'degraded' || healthReport.router === 'unhealthy') {
      degradedComponents.push(`Router (${healthReport.router})`);
    }
    if (healthReport.quota.status === 'degraded' || healthReport.quota.status === 'unhealthy') {
      degradedComponents.push(`Quota storage (${healthReport.quota.status})`);
    }
    if (healthReport.reconciliation.status === 'degraded' || healthReport.reconciliation.status === 'unhealthy') {
      degradedComponents.push(`Reconciliation (${healthReport.reconciliation.status})`);
    }

    const response: OperationalStatusResponse = {
      status: healthReport.status,
      timestamp,
      uptimeSeconds,
      controllerVersion: '1.0.0',
      nodeEnv: env.NODE_ENV,
      openwrt: {
        host: env.OPENWRT_HOST ?? 'unconfigured',
        port: env.OPENWRT_SSH_PORT ?? 22,
        circuitBreaker: cbDiags.state,
        consecutiveFailures: cbDiags.consecutiveFailures,
        lastFailureTime: cbDiags.lastFailureTime,
        lastSuccessTime: cbDiags.lastSuccessTime,
      },
      monitor: {
        running: monitorStatus.running,
        syncInProgress: monitorStatus.syncInProgress ?? false,
        intervalMs: monitorStatus.intervalMs,
        enabled: monitorStatus.enabled,
        lastRunAt: monitorStatus.lastRunAt,
        lastRunDurationMs: monitorStatus.lastRunDurationMs,
        lastRunSuccess: monitorStatus.lastRunSuccess,
        totalRuns: monitorStatus.totalRuns,
        consecutiveErrors: monitorStatus.consecutiveErrors,
      },
      lastEnforcement: {
        reconciliationId: monitorStatus.reconciliationId ?? null,
        lastStartedAt: monitorStatus.lastStartedAt ?? null,
        lastCompletedAt: monitorStatus.lastCompletedAt ?? null,
        lastSuccessfulAt: monitorStatus.lastSuccessfulAt ?? null,
        lastFailureAt: monitorStatus.lastFailureAt ?? null,
        durationMs: monitorStatus.lastDurationMs ?? null,
        devicesEvaluated: monitorStatus.devicesEvaluated ?? 0,
        devicesBlocked: monitorStatus.devicesBlocked ?? 0,
        devicesUnblocked: monitorStatus.devicesUnblocked ?? 0,
        success: monitorStatus.lastRunSuccess,
      },
      lastReconciliation: {
        timestamp: monitorStatus.lastRunAt,
        success: monitorStatus.lastRunSuccess,
        reconciliationId: monitorStatus.reconciliationId ?? null,
      },
      metricsSummary: {
        httpRequestsTotal: this.metrics.get('http_requests_total'),
        httpErrorsTotal: this.metrics.get('http_errors_total'),
        sshAttempts: this.metrics.get('openwrt_ssh_attempts_total'),
        sshFailures: this.metrics.get('openwrt_ssh_failures_total') || this.metrics.get('ssh_failures'),
        enforcementCycles: this.metrics.get('quota_enforcement_cycles_total') || this.metrics.get('reconciliation_runs'),
        circuitBreakerOpens: this.metrics.get('resilience_circuit_breaker_opens_total'),
        devicesBlockedTotal: this.metrics.get('devices_blocked_total') || this.metrics.get('devices_blocked'),
        devicesUnblockedTotal: this.metrics.get('devices_unblocked_total') || this.metrics.get('devices_unblocked'),
      },
      degradedComponents,
    };

    const statusCode = healthReport.status === 'unhealthy' ? 503 : 200;
    return reply.status(statusCode).send(response);
  };
}

export const operationsController = new OperationsController();

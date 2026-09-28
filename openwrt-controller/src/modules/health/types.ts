export type SystemHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface SubsystemHealth {
  status: SystemHealthStatus;
  circuitBreaker?: string;
  details?: string;
  [key: string]: unknown;
}

export interface ReconciliationHealth extends SubsystemHealth {
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  consecutiveErrors?: number;
}

export interface HealthReport {
  status: SystemHealthStatus;
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  firewall: SubsystemHealth;
  quota: SubsystemHealth;
  reconciliation: ReconciliationHealth;
}

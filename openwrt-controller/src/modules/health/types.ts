export type SystemHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

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
  router?: SystemHealthStatus;
  firewall: SubsystemHealth;
  quota: SubsystemHealth;
  reconciliation: ReconciliationHealth;
  monitor?: string;
}

export interface LivenessReport {
  status: 'alive' | 'healthy';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  pid: number;
  memoryUsage: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
}

export interface ReadinessSubsystemState {
  ready: boolean;
  status?: SystemHealthStatus | undefined;
  circuitBreaker?: string | undefined;
  consecutiveFailures?: number | undefined;
  state?: string | undefined;
  details?: string | undefined;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  ready: boolean;
  subsystems: {
    quotaStorage: ReadinessSubsystemState;
    routerConnectivity: ReadinessSubsystemState;
    firewall: ReadinessSubsystemState;
    monitor: ReadinessSubsystemState;
  };
  degradedReasons?: string[] | undefined;
}

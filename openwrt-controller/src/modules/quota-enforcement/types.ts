/**
 * Types and interfaces for the Quota Enforcement subsystem.
 */

export type DeviceEnforcementAction = 'blocked' | 'unblocked' | 'none';

export interface DeviceEnforcementResult {
  mac: string;
  action: DeviceEnforcementAction;
  quotaStatus: 'active' | 'exhausted' | 'deleted';
  success: boolean;
  reason?: string | undefined;
  error?: string | undefined;
}

export interface EnforcementCycleResult {
  timestamp: string;
  durationMs: number;
  totalEvaluated: number;
  blockedCount: number;
  unblockedCount: number;
  unchangedCount: number;
  errorCount: number;
  results: DeviceEnforcementResult[];
  success: boolean;
  error?: string | undefined;
  reconciliationId?: string | undefined;
}

export interface EnforcementMonitorStatus {
  running: boolean;
  intervalMs: number;
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

export interface QuotaEnforcementStatusResponse extends EnforcementMonitorStatus {
  success: boolean;
}

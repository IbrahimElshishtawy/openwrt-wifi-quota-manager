/**
 * Types and interfaces for the Quota Enforcement subsystem.
 */

export type DeviceEnforcementAction = 'blocked' | 'unblocked' | 'none';

export interface DeviceEnforcementResult {
  mac: string;
  action: DeviceEnforcementAction;
  quotaStatus: 'active' | 'exhausted';
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
}

export interface QuotaEnforcementStatusResponse extends EnforcementMonitorStatus {
  success: boolean;
}

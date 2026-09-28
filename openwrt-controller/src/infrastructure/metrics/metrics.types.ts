export type MetricType = 'counter' | 'gauge' | 'histogram';

export type StandardCounterName =
  // HTTP
  | 'http_requests_total'
  | 'http_errors_total'
  // OpenWrt
  | 'openwrt_ssh_attempts_total'
  | 'openwrt_ssh_successes_total'
  | 'openwrt_ssh_failures_total'
  | 'openwrt_ubus_calls_total'
  | 'openwrt_ubus_failures_total'
  | 'openwrt_nftables_operations_total'
  | 'openwrt_nftables_failures_total'
  // Quota
  | 'quota_enforcement_cycles_total'
  | 'quota_enforcement_successes_total'
  | 'quota_enforcement_failures_total'
  | 'quota_reconciliation_cycles_total'
  | 'quota_reconciliation_failures_total'
  | 'devices_blocked_total'
  | 'devices_unblocked_total'
  // Resilience
  | 'resilience_retry_attempts_total'
  | 'resilience_retry_exhausted_total'
  | 'resilience_circuit_breaker_opens_total'
  | 'resilience_circuit_breaker_half_open_probes_total'
  | 'resilience_circuit_breaker_closes_total'
  // Shutdown
  | 'graceful_shutdown_count'
  // Legacy / Phase 16 & 17 compatibility
  | 'reconciliation_runs'
  | 'reconciliation_successes'
  | 'reconciliation_failures'
  | 'quota_devices_evaluated'
  | 'quota_devices_exhausted'
  | 'devices_blocked'
  | 'devices_unblocked'
  | 'firewall_operations'
  | 'firewall_operation_failures'
  | 'ssh_failures'
  | 'orphan_blocks_detected'
  | 'orphan_blocks_removed'
  | 'manual_blocks_restored'
  | 'recovery_actions';

export type StandardGaugeName =
  | 'http_active_requests'
  | 'resilience_circuit_breaker_state' // 0: CLOSED, 1: HALF_OPEN, 2: OPEN
  | 'quota_records_total'
  | 'quota_active_total'
  | 'quota_exhausted_total'
  | 'quota_blocked_devices_total'
  | 'process_uptime_seconds'
  | 'process_memory_rss_bytes'
  | 'process_memory_heap_used_bytes'
  | 'process_memory_heap_total_bytes'
  | 'process_event_loop_lag_ms';

export type StandardHistogramName =
  | 'http_request_duration_ms'
  | 'openwrt_ssh_duration_ms'
  | 'quota_enforcement_duration_ms';

export type MetricName = StandardCounterName | StandardGaugeName | StandardHistogramName | (string & {});

export type MetricLabels = Record<string, string | number>;

export interface HistogramSnapshot {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  last: number;
}

export type MetricsSnapshot = Record<string, number | HistogramSnapshot>;

export interface CategorizedMetrics {
  http: {
    totalRequests: number;
    activeRequests: number;
    totalErrors: number;
    durationMs: HistogramSnapshot;
    requestsByMethod: Record<string, number>;
    requestsByRoute: Record<string, number>;
    requestsByStatus: Record<string, number>;
  };
  openwrt: {
    sshAttempts: number;
    sshSuccesses: number;
    sshFailures: number;
    sshDurationMs: HistogramSnapshot;
    ubusCalls: number;
    ubusFailures: number;
    nftablesOperations: number;
    nftablesFailures: number;
  };
  quota: {
    totalQuotas: number;
    activeQuotas: number;
    exhaustedQuotas: number;
    blockedDevices: number;
    enforcementCycles: number;
    enforcementSuccesses: number;
    enforcementFailures: number;
    reconciliationCycles: number;
    reconciliationFailures: number;
    enforcementDurationMs: HistogramSnapshot;
  };
  resilience: {
    circuitBreakerState: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
    circuitBreakerStateValue: number;
    circuitBreakerOpens: number;
    circuitBreakerHalfOpenProbes: number;
    circuitBreakerCloses: number;
    retryAttempts: number;
    retryExhausted: number;
  };
  system: {
    uptimeSeconds: number;
    memoryRssBytes: number;
    memoryHeapUsedBytes: number;
    memoryHeapTotalBytes: number;
    gracefulShutdownCount: number;
  };
}

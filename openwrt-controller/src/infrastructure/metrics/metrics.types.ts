export type MetricName =
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
  | 'recovery_actions'
  | (string & {});

export type MetricsSnapshot = Record<string, number>;

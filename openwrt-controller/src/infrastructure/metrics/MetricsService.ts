import type { MetricName, MetricsSnapshot } from './metrics.types.js';

export const STANDARD_METRICS: MetricName[] = [
  'reconciliation_runs',
  'reconciliation_successes',
  'reconciliation_failures',
  'quota_devices_evaluated',
  'quota_devices_exhausted',
  'devices_blocked',
  'devices_unblocked',
  'firewall_operations',
  'firewall_operation_failures',
  'ssh_failures',
  'orphan_blocks_detected',
  'orphan_blocks_removed',
  'manual_blocks_restored',
  'recovery_actions',
];

export class MetricsService {
  private readonly metrics = new Map<string, number>();

  constructor() {
    this.reset();
  }

  public increment(name: MetricName, by = 1): number {
    const current = this.metrics.get(name) ?? 0;
    const updated = current + by;
    this.metrics.set(name, updated);
    return updated;
  }

  public set(name: MetricName, value: number): void {
    this.metrics.set(name, value);
  }

  public get(name: MetricName): number {
    return this.metrics.get(name) ?? 0;
  }

  public snapshot(): MetricsSnapshot {
    const obj: MetricsSnapshot = {};
    for (const [key, value] of this.metrics.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  public reset(): void {
    this.metrics.clear();
    for (const metric of STANDARD_METRICS) {
      this.metrics.set(metric, 0);
    }
  }
}

export const metricsService = new MetricsService();

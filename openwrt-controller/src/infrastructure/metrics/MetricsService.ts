import { monitorEventLoopDelay } from 'node:perf_hooks';
import type {
  MetricName,
  MetricsSnapshot,
  HistogramSnapshot,
  CategorizedMetrics,
  MetricLabels,
} from './metrics.types.js';

export const LEGACY_METRICS: MetricName[] = [
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

interface HistogramState {
  count: number;
  sum: number;
  min: number;
  max: number;
  last: number;
}

/**
 * Production Metrics Registry & Service.
 *
 * Provides typed, low-overhead in-memory metrics collection with:
 * - Counters, Gauges, and Histograms
 * - Label dimensions (e.g. method, route, status code)
 * - Safe concurrent access
 * - Zero external dependencies
 * - Full Prometheus exposition format export
 * - Categorized JSON summary for administrative dashboards
 */
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly eld?: ReturnType<typeof monitorEventLoopDelay>;

  // Label-keyed counters: Map<metricName, Map<labelKeyString, number>>
  private readonly labeledCounters = new Map<string, Map<string, { labels: MetricLabels; value: number }>>();

  constructor() {
    try {
      this.eld = monitorEventLoopDelay({ resolution: 20 });
      this.eld.enable();
    } catch {
      // Fallback if environment doesn't allow event loop monitoring
    }
    this.reset();
  }

  public increment(name: MetricName, by = 1, labels?: MetricLabels): number {
    if (labels && Object.keys(labels).length > 0) {
      this.incrementLabeled(name, by, labels);
    }

    if (this.gauges.has(name)) {
      const current = this.gauges.get(name) ?? 0;
      const updated = current + by;
      this.gauges.set(name, updated);
      return updated;
    }

    const current = this.counters.get(name) ?? 0;
    const updated = current + by;
    this.counters.set(name, updated);
    return updated;
  }

  public decrement(name: MetricName, by = 1): number {
    return this.increment(name, -by);
  }

  public set(name: MetricName, value: number): void {
    this.gauges.set(name, value);
  }

  public get(name: MetricName): number {
    if (this.gauges.has(name)) {
      return this.gauges.get(name) ?? 0;
    }
    return this.counters.get(name) ?? 0;
  }

  public observe(name: MetricName, value: number): void {
    let hist = this.histograms.get(name);
    if (!hist) {
      hist = {
        count: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        last: 0,
      };
      this.histograms.set(name, hist);
    }

    hist.count++;
    hist.sum += value;
    hist.last = value;
    if (value < hist.min) hist.min = value;
    if (value > hist.max) hist.max = value;
  }

  public getHistogram(name: MetricName): HistogramSnapshot {
    const hist = this.histograms.get(name);
    if (!hist || hist.count === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, avg: 0, last: 0 };
    }
    return {
      count: hist.count,
      sum: hist.sum,
      min: hist.min === Number.POSITIVE_INFINITY ? 0 : hist.min,
      max: hist.max === Number.NEGATIVE_INFINITY ? 0 : hist.max,
      avg: Math.round((hist.sum / hist.count) * 100) / 100,
      last: hist.last,
    };
  }

  private incrementLabeled(name: string, by: number, labels: MetricLabels): void {
    let group = this.labeledCounters.get(name);
    if (!group) {
      group = new Map();
      this.labeledCounters.set(name, group);
    }

    const key = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');

    const existing = group.get(key);
    if (existing) {
      existing.value += by;
    } else {
      group.set(key, { labels, value: by });
    }
  }

  public getLabeledCounters(name: string): Array<{ labels: MetricLabels; value: number }> {
    const group = this.labeledCounters.get(name);
    if (!group) return [];
    return Array.from(group.values());
  }

  /**
   * Returns a flattened snapshot compatible with Phase 16/17 unit tests.
   */
  public snapshot(): MetricsSnapshot {
    const obj: MetricsSnapshot = {};

    for (const [key, value] of this.counters.entries()) {
      obj[key] = value;
    }
    for (const [key, value] of this.gauges.entries()) {
      obj[key] = value;
    }
    for (const [key] of this.histograms.entries()) {
      obj[key] = this.getHistogram(key);
    }

    return obj;
  }

  /**
   * Returns cleanly structured, categorized metrics for operations status.
   */
  public getCategorizedMetrics(): CategorizedMetrics {
    const mem = process.memoryUsage();
    const cbStateVal = this.get('resilience_circuit_breaker_state');
    const cbStateStr = cbStateVal === 2 ? 'OPEN' : cbStateVal === 1 ? 'HALF_OPEN' : 'CLOSED';

    const requestsByMethod: Record<string, number> = {};
    const requestsByRoute: Record<string, number> = {};
    const requestsByStatus: Record<string, number> = {};

    for (const entry of this.getLabeledCounters('http_requests_total')) {
      const m = String(entry.labels.method ?? 'UNKNOWN');
      const r = String(entry.labels.route ?? 'UNKNOWN');
      const s = String(entry.labels.status ?? 'UNKNOWN');

      requestsByMethod[m] = (requestsByMethod[m] ?? 0) + entry.value;
      requestsByRoute[r] = (requestsByRoute[r] ?? 0) + entry.value;
      requestsByStatus[s] = (requestsByStatus[s] ?? 0) + entry.value;
    }

    return {
      http: {
        totalRequests: this.get('http_requests_total'),
        activeRequests: Math.max(0, this.get('http_active_requests')),
        totalErrors: this.get('http_errors_total'),
        durationMs: this.getHistogram('http_request_duration_ms'),
        requestsByMethod,
        requestsByRoute,
        requestsByStatus,
      },
      openwrt: {
        sshAttempts: this.get('openwrt_ssh_attempts_total'),
        sshSuccesses: this.get('openwrt_ssh_successes_total'),
        sshFailures: this.get('openwrt_ssh_failures_total') || this.get('ssh_failures'),
        sshDurationMs: this.getHistogram('openwrt_ssh_duration_ms'),
        ubusCalls: this.get('openwrt_ubus_calls_total'),
        ubusFailures: this.get('openwrt_ubus_failures_total'),
        nftablesOperations: this.get('openwrt_nftables_operations_total') || this.get('firewall_operations'),
        nftablesFailures: this.get('openwrt_nftables_failures_total') || this.get('firewall_operation_failures'),
      },
      quota: {
        totalQuotas: this.get('quota_records_total'),
        activeQuotas: this.get('quota_active_total'),
        exhaustedQuotas: this.get('quota_exhausted_total'),
        blockedDevices: this.get('quota_blocked_devices_total'),
        enforcementCycles: this.get('quota_enforcement_cycles_total') || this.get('reconciliation_runs'),
        enforcementSuccesses: this.get('quota_enforcement_successes_total') || this.get('reconciliation_successes'),
        enforcementFailures: this.get('quota_enforcement_failures_total') || this.get('reconciliation_failures'),
        reconciliationCycles: this.get('quota_reconciliation_cycles_total') || this.get('reconciliation_runs'),
        reconciliationFailures: this.get('quota_reconciliation_failures_total') || this.get('reconciliation_failures'),
        enforcementDurationMs: this.getHistogram('quota_enforcement_duration_ms'),
      },
      resilience: {
        circuitBreakerState: cbStateStr,
        circuitBreakerStateValue: cbStateVal,
        circuitBreakerOpens: this.get('resilience_circuit_breaker_opens_total'),
        circuitBreakerHalfOpenProbes: this.get('resilience_circuit_breaker_half_open_probes_total'),
        circuitBreakerCloses: this.get('resilience_circuit_breaker_closes_total'),
        retryAttempts: this.get('resilience_retry_attempts_total'),
        retryExhausted: this.get('resilience_retry_exhausted_total'),
      },
      system: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssBytes: mem.rss,
        memoryHeapUsedBytes: mem.heapUsed,
        memoryHeapTotalBytes: mem.heapTotal,
        gracefulShutdownCount: this.get('graceful_shutdown_count'),
      },
    };
  }

  /**
   * Generates standard Prometheus text exposition format (version 0.0.4).
   * Safe, sanitized, and zero overhead.
   */
  public toPrometheusFormat(): string {
    const lines: string[] = [];
    const mem = process.memoryUsage();

    // Helper to add typed metric
    const addMetric = (
      name: string,
      type: 'counter' | 'gauge',
      help: string,
      value: number,
      labels?: MetricLabels
    ) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      if (labels && Object.keys(labels).length > 0) {
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
          .join(',');
        lines.push(`${name}{${labelStr}} ${value}`);
      } else {
        lines.push(`${name} ${value}`);
      }
    };

    // System Gauges
    addMetric('process_uptime_seconds', 'gauge', 'Process uptime in seconds', Math.floor(process.uptime()));
    addMetric('process_memory_rss_bytes', 'gauge', 'Resident set size in bytes', mem.rss);
    addMetric('process_memory_heap_used_bytes', 'gauge', 'Heap memory used in bytes', mem.heapUsed);
    addMetric('process_memory_heap_total_bytes', 'gauge', 'Total heap memory in bytes', mem.heapTotal);

    let lagMs = 0;
    if (this.eld && Number.isFinite(this.eld.mean) && this.eld.mean > 0) {
      lagMs = Math.round((this.eld.mean / 1_000_000) * 100) / 100;
    }
    addMetric('process_event_loop_lag_ms', 'gauge', 'Node.js Event Loop Lag in milliseconds', lagMs);

    // HTTP
    addMetric('http_active_requests', 'gauge', 'Currently active in-flight HTTP requests', Math.max(0, this.get('http_active_requests')));
    addMetric('http_requests_total', 'counter', 'Total incoming HTTP requests', this.get('http_requests_total'));
    addMetric('http_errors_total', 'counter', 'Total HTTP responses with 4xx or 5xx status', this.get('http_errors_total'));

    for (const item of this.getLabeledCounters('http_requests_total')) {
      const labelStr = Object.entries(item.labels)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
        .join(',');
      lines.push(`http_requests_total{${labelStr}} ${item.value}`);
    }

    // OpenWrt
    addMetric('openwrt_ssh_attempts_total', 'counter', 'Total SSH execution attempts targeting router', this.get('openwrt_ssh_attempts_total'));
    addMetric('openwrt_ssh_successes_total', 'counter', 'Total successful SSH executions', this.get('openwrt_ssh_successes_total'));
    addMetric('openwrt_ssh_failures_total', 'counter', 'Total failed SSH executions', this.get('openwrt_ssh_failures_total') || this.get('ssh_failures'));
    addMetric('openwrt_ubus_calls_total', 'counter', 'Total ubus API calls', this.get('openwrt_ubus_calls_total'));
    addMetric('openwrt_ubus_failures_total', 'counter', 'Total failed ubus API calls', this.get('openwrt_ubus_failures_total'));
    addMetric('openwrt_nftables_operations_total', 'counter', 'Total nftables rule operations', this.get('openwrt_nftables_operations_total') || this.get('firewall_operations'));
    addMetric('openwrt_nftables_failures_total', 'counter', 'Total failed nftables rule operations', this.get('openwrt_nftables_failures_total') || this.get('firewall_operation_failures'));

    // Quota & Enforcement
    addMetric('quota_enforcement_cycles_total', 'counter', 'Total periodic quota enforcement cycles', this.get('quota_enforcement_cycles_total') || this.get('reconciliation_runs'));
    addMetric('quota_enforcement_successes_total', 'counter', 'Total successful quota enforcement cycles', this.get('quota_enforcement_successes_total') || this.get('reconciliation_successes'));
    addMetric('quota_enforcement_failures_total', 'counter', 'Total failed quota enforcement cycles', this.get('quota_enforcement_failures_total') || this.get('reconciliation_failures'));
    addMetric('devices_blocked_total', 'counter', 'Total device firewall blocks applied', this.get('devices_blocked_total') || this.get('devices_blocked'));
    addMetric('devices_unblocked_total', 'counter', 'Total device firewall blocks lifted', this.get('devices_unblocked_total') || this.get('devices_unblocked'));

    // Resilience
    addMetric('resilience_circuit_breaker_state', 'gauge', 'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)', this.get('resilience_circuit_breaker_state'));
    addMetric('resilience_circuit_breaker_opens_total', 'counter', 'Total circuit breaker trips to OPEN', this.get('resilience_circuit_breaker_opens_total'));
    addMetric('resilience_circuit_breaker_half_open_probes_total', 'counter', 'Total circuit breaker probe attempts in HALF_OPEN', this.get('resilience_circuit_breaker_half_open_probes_total'));
    addMetric('resilience_circuit_breaker_closes_total', 'counter', 'Total circuit breaker recoveries to CLOSED', this.get('resilience_circuit_breaker_closes_total'));
    addMetric('resilience_retry_attempts_total', 'counter', 'Total retry attempts', this.get('resilience_retry_attempts_total'));
    addMetric('resilience_retry_exhausted_total', 'counter', 'Total retries exhausted', this.get('resilience_retry_exhausted_total'));

    // Histograms
    for (const [name, hist] of this.histograms.entries()) {
      lines.push(`# HELP ${name} Histogram duration metric in ms`);
      lines.push(`# TYPE ${name} summary`);
      lines.push(`${name}_count ${hist.count}`);
      lines.push(`${name}_sum ${hist.sum}`);
    }

    return lines.join('\n') + '\n';
  }

  public reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.labeledCounters.clear();

    if (this.eld) {
      try {
        this.eld.reset();
      } catch {
        // Safe ignore
      }
    }

    for (const metric of LEGACY_METRICS) {
      this.counters.set(metric, 0);
    }

    this.counters.set('http_requests_total', 0);
    this.counters.set('http_errors_total', 0);
    this.gauges.set('http_active_requests', 0);
    this.counters.set('openwrt_ssh_attempts_total', 0);
    this.counters.set('openwrt_ssh_successes_total', 0);
    this.counters.set('openwrt_ssh_failures_total', 0);
    this.counters.set('quota_enforcement_cycles_total', 0);
    this.counters.set('quota_enforcement_successes_total', 0);
    this.counters.set('quota_enforcement_failures_total', 0);
    this.gauges.set('resilience_circuit_breaker_state', 0); // 0 = CLOSED
    this.counters.set('resilience_circuit_breaker_opens_total', 0);
    this.counters.set('resilience_circuit_breaker_half_open_probes_total', 0);
    this.counters.set('resilience_circuit_breaker_closes_total', 0);
    this.counters.set('graceful_shutdown_count', 0);
  }
}

export const metricsService = new MetricsService();

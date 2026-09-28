import type { FastifyRequest, FastifyReply } from 'fastify';
import { metricsService, MetricsService } from './MetricsService.js';

const START_TIME_SYMBOL = Symbol('request_start_time');

export interface HttpMetricsOptions {
  metrics?: MetricsService;
}

/**
 * Creates Fastify hooks for tracking incoming HTTP requests, latencies,
 * status codes, active requests, and error rates.
 */
export function createHttpMetricsHooks(options: HttpMetricsOptions = {}) {
  const metrics = options.metrics ?? metricsService;

  const onRequestHook = async (request: FastifyRequest): Promise<void> => {
    metrics.increment('http_active_requests', 1);
    // Attach high-resolution start time
    (request as unknown as Record<symbol, bigint>)[START_TIME_SYMBOL] = process.hrtime.bigint();
  };

  const onResponseHook = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    metrics.decrement('http_active_requests', 1);

    const startTime = (request as unknown as Record<symbol, bigint>)[START_TIME_SYMBOL];
    let durationMs = 0;
    if (startTime) {
      const diffNs = process.hrtime.bigint() - startTime;
      durationMs = Number(diffNs) / 1_000_000;
      metrics.observe('http_request_duration_ms', durationMs);
    }

    const method = request.method;
    // Normalize route URL or fall back to raw url path
    const route = request.routeOptions?.url ?? request.url.split('?')[0] ?? 'unknown';
    const status = String(reply.statusCode);

    metrics.increment('http_requests_total', 1, { method, route, status });

    if (reply.statusCode >= 400) {
      metrics.increment('http_errors_total', 1, { method, route, status });
    }
  };

  return {
    onRequest: onRequestHook,
    onResponse: onResponseHook,
  };
}

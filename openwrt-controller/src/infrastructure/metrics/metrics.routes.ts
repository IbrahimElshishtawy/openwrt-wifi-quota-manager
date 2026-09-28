import type { FastifyPluginAsync } from 'fastify';
import { metricsService, MetricsService } from './MetricsService.js';

export interface MetricsRoutesOptions {
  metrics?: MetricsService;
}

export const metricsRoutes: FastifyPluginAsync<MetricsRoutesOptions> = async (fastify, options) => {
  const metrics = options.metrics ?? metricsService;

  // 1. Prometheus Text Exposition format
  fastify.get('/metrics', async (_request, reply) => {
    const prometheusText = metrics.toPrometheusFormat();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .status(200)
      .send(prometheusText);
  });

  // 2. Structured JSON format for API clients and admin dashboards
  fastify.get('/api/metrics', async (_request, reply) => {
    const categorized = metrics.getCategorizedMetrics();
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .status(200)
      .send({
        success: true,
        timestamp: new Date().toISOString(),
        metrics: categorized,
      });
  });
};

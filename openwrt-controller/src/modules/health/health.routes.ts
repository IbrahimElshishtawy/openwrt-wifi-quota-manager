import type { FastifyPluginAsync } from 'fastify';
import { HealthController, healthController as defaultHealthController } from './HealthController.js';
import type { HealthService } from './HealthService.js';

export interface HealthRoutesOptions {
  controller?: HealthController;
  service?: HealthService;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (fastify, options) => {
  const controller =
    options.controller ??
    (options.service ? new HealthController(options.service) : defaultHealthController);

  // 1. Comprehensive Health Check (Phase 16/17 backward-compatible)
  fastify.get('/api/health', controller.getHealth);
  fastify.get('/health', controller.getHealth);

  // 2. Liveness Check (Phase 18)
  fastify.get('/api/health/live', controller.getLiveness);
  fastify.get('/health/live', controller.getLiveness);

  // 3. Readiness Check (Phase 18)
  fastify.get('/api/health/ready', controller.getReadiness);
  fastify.get('/health/ready', controller.getReadiness);
};

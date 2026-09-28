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

  fastify.get('/api/health', controller.getHealth);
  fastify.get('/health', controller.getHealth);
};

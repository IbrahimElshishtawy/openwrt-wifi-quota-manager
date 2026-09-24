import type { FastifyPluginAsync } from 'fastify';
import { usageController, UsageController } from './UsageController.js';
import { UsageService } from './UsageService.js';
import { getUsageRouteSchema } from './usage.schemas.js';

export interface UsageRoutesOptions {
  controller?: UsageController;
  service?: UsageService;
}

export const usageRoutes: FastifyPluginAsync<UsageRoutesOptions> = async (fastify, options) => {
  const controller =
    options.controller ??
    (options.service ? new UsageController(options.service) : usageController);

  // Primary API endpoint requested: GET /api/usage
  fastify.get('/api/usage', getUsageRouteSchema, controller.getUsage);

  // Backward-compatibility endpoint: GET /usage
  fastify.get('/usage', getUsageRouteSchema, controller.getUsage);
};

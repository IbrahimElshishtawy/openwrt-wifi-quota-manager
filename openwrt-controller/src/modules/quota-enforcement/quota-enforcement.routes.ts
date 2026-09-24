import type { FastifyPluginAsync } from 'fastify';
import {
  QuotaEnforcementController,
  quotaEnforcementController,
} from './QuotaEnforcementController.js';
import { QuotaEnforcementMonitor } from './QuotaEnforcementMonitor.js';

export interface QuotaEnforcementRoutesOptions {
  controller?: QuotaEnforcementController;
  monitor?: QuotaEnforcementMonitor;
}

export const quotaEnforcementRoutes: FastifyPluginAsync<QuotaEnforcementRoutesOptions> = async (
  fastify,
  options
) => {
  const controller =
    options.controller ??
    (options.monitor
      ? new QuotaEnforcementController(options.monitor)
      : quotaEnforcementController);

  // Administrative / monitoring telemetry endpoint
  fastify.get('/api/quota-enforcement/status', controller.getStatus);
  fastify.get('/quota-enforcement/status', controller.getStatus);
};

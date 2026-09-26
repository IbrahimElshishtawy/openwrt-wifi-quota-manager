import type { FastifyPluginAsync } from 'fastify';
import { quotaController, QuotaController } from './QuotaController.js';
import { QuotaService } from './QuotaService.js';
import {
  createQuotaRouteSchema,
  getAllQuotasRouteSchema,
  getQuotaByMacRouteSchema,
  updateQuotaRouteSchema,
  deleteQuotaRouteSchema,
} from './quota.schemas.js';

export interface QuotaRoutesOptions {
  controller?: QuotaController;
  service?: QuotaService;
}

export const quotaRoutes: FastifyPluginAsync<QuotaRoutesOptions> = async (fastify, options) => {
  const controller =
    options.controller ??
    (options.service ? new QuotaController(options.service) : quotaController);

  // POST /api/quotas - Create / assign quota
  fastify.post('/api/quotas', createQuotaRouteSchema, controller.createQuota);
  fastify.post('/quotas', createQuotaRouteSchema, controller.createQuota);

  // GET /api/quotas - Get all device quotas
  fastify.get('/api/quotas', getAllQuotasRouteSchema, controller.getAllQuotas);
  fastify.get('/quotas', getAllQuotasRouteSchema, controller.getAllQuotas);

  // GET /api/quotas/:mac - Get single device quota
  fastify.get('/api/quotas/:mac', getQuotaByMacRouteSchema, controller.getQuotaByMac);
  fastify.get('/quotas/:mac', getQuotaByMacRouteSchema, controller.getQuotaByMac);

  // PATCH /api/quotas/:mac - Update quota limit / reset usage
  fastify.patch('/api/quotas/:mac', updateQuotaRouteSchema, controller.updateQuota);
  fastify.patch('/quotas/:mac', updateQuotaRouteSchema, controller.updateQuota);

  // POST /api/quotas/:mac/reset - Reset quota usage
  fastify.post('/api/quotas/:mac/reset', getQuotaByMacRouteSchema, controller.resetQuota);
  fastify.post('/quotas/:mac/reset', getQuotaByMacRouteSchema, controller.resetQuota);

  // DELETE /api/quotas/:mac - Delete quota
  fastify.delete('/api/quotas/:mac', deleteQuotaRouteSchema, controller.deleteQuota);
  fastify.delete('/quotas/:mac', deleteQuotaRouteSchema, controller.deleteQuota);
};

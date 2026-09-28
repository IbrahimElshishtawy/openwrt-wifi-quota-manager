import type { FastifyPluginAsync } from 'fastify';
import {
  OperationsController,
  operationsController as defaultOperationsController,
} from './OperationsController.js';

export interface OperationsRoutesOptions {
  controller?: OperationsController;
}

export const operationsRoutes: FastifyPluginAsync<OperationsRoutesOptions> = async (
  fastify,
  options
) => {
  const controller = options.controller ?? defaultOperationsController;

  fastify.get('/api/operations/status', controller.getStatus);
  fastify.get('/operations/status', controller.getStatus);
};

import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  QuotaEnforcementMonitor,
  quotaEnforcementMonitor as defaultMonitor,
} from './QuotaEnforcementMonitor.js';

/**
 * Controller providing read-only administrative inspection of the Quota Enforcement Monitor.
 */
export class QuotaEnforcementController {
  constructor(
    private readonly monitor: QuotaEnforcementMonitor = defaultMonitor
  ) {}

  public getStatus = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const status = this.monitor.getStatus();

    return reply.status(200).send({
      success: true,
      ...status,
    });
  };
}

export const quotaEnforcementController = new QuotaEnforcementController();

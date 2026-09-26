import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  QuotaEnforcementMonitor as ModuleMonitor,
  quotaEnforcementMonitor as moduleDefaultMonitor,
} from './QuotaEnforcementMonitor.js';
import {
  QuotaEnforcementMonitor as CanonicalMonitor,
  quotaEnforcementMonitor as canonicalDefaultMonitor,
} from '../quota/QuotaEnforcementMonitor.js';
import type { EnforcementMonitorStatus } from './types.js';

export interface IQuotaStatusProvider {
  getStatus(): EnforcementMonitorStatus | (EnforcementMonitorStatus & { enabled?: boolean });
}

/**
 * Controller providing read-only administrative inspection of the Quota Enforcement Monitor.
 */
export class QuotaEnforcementController {
  constructor(
    private readonly monitor: IQuotaStatusProvider = canonicalDefaultMonitor
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

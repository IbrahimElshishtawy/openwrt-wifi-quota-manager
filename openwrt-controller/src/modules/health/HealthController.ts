import type { FastifyRequest, FastifyReply } from 'fastify';
import { HealthService, healthService as defaultHealthService } from './HealthService.js';

export class HealthController {
  constructor(private readonly service: HealthService = defaultHealthService) {}

  public getHealth = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const report = await this.service.getHealth();
    const statusCode = report.status === 'unhealthy' ? 503 : 200;
    return reply.status(statusCode).send(report);
  };
}

export const healthController = new HealthController();

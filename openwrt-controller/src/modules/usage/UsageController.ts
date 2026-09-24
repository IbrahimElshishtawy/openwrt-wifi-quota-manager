import type { FastifyRequest, FastifyReply } from 'fastify';
import { usageService, type UsageService } from './UsageService.js';
import type { UsageApiResponse } from './types.js';

export class UsageController {
  constructor(private readonly service: UsageService = usageService) {}

  /**
   * Handles GET /api/usage (and GET /usage).
   * Retrieves real-time per-device bandwidth usage and returns standard JSON payload.
   */
  public getUsage = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const usage = await this.service.getDeviceUsage();

    const responsePayload: UsageApiResponse = {
      success: true,
      data: usage,
      count: usage.length,
    };

    reply.status(200).send(responsePayload);
  };
}

export const usageController = new UsageController();

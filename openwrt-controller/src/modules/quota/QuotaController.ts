import type { FastifyRequest, FastifyReply } from 'fastify';
import { quotaService, type QuotaService } from './QuotaService.js';
import {
  createQuotaSchema,
  updateQuotaSchema,
  macParamsSchema,
  type CreateQuotaInput,
  type UpdateQuotaInput,
  type MacParamsInput,
} from './quota.schemas.js';
import type {
  QuotaApiResponse,
  QuotaListApiResponse,
  QuotaDeleteApiResponse,
} from './types.js';

export class QuotaController {
  constructor(private readonly service: QuotaService = quotaService) {}

  /**
   * POST /api/quotas
   * Assigns a new internet quota to a LAN client device.
   */
  public createQuota = async (
    request: FastifyRequest<{ Body: CreateQuotaInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const input = createQuotaSchema.parse(request.body);
    const quota = await this.service.createQuota(input);

    const response: QuotaApiResponse = {
      success: true,
      data: quota,
    };

    reply.status(201).send(response);
  };

  /**
   * GET /api/quotas
   * Retrieves all assigned quotas with real-time usage metrics.
   */
  public getAllQuotas = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const quotas = await this.service.getAllQuotas();

    const response: QuotaListApiResponse = {
      success: true,
      data: quotas,
      count: quotas.length,
    };

    reply.status(200).send(response);
  };

  /**
   * GET /api/quotas/:mac
   * Retrieves quota details for a specific device.
   */
  public getQuotaByMac = async (
    request: FastifyRequest<{ Params: MacParamsInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const params = macParamsSchema.parse(request.params);
    const quota = await this.service.getQuotaByMac(params.mac);

    const response: QuotaApiResponse = {
      success: true,
      data: quota,
    };

    reply.status(200).send(response);
  };

  /**
   * PATCH /api/quotas/:mac
   * Updates an existing quota limit or explicitly resets usage.
   */
  public updateQuota = async (
    request: FastifyRequest<{ Params: MacParamsInput; Body: UpdateQuotaInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const params = macParamsSchema.parse(request.params);
    const body = updateQuotaSchema.parse(request.body);
    const quota = await this.service.updateQuota(params.mac, body);

    const response: QuotaApiResponse = {
      success: true,
      data: quota,
    };

    reply.status(200).send(response);
  };

  /**
   * DELETE /api/quotas/:mac
   * Removes a quota assignment for a device.
   */
  public deleteQuota = async (
    request: FastifyRequest<{ Params: MacParamsInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    const params = macParamsSchema.parse(request.params);
    await this.service.deleteQuota(params.mac);

    const response: QuotaDeleteApiResponse = {
      success: true,
      message: `Quota removed for device ${params.mac}`,
    };

    reply.status(200).send(response);
  };
}

export const quotaController = new QuotaController();

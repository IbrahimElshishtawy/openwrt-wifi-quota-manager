import type { FastifyRequest, FastifyReply } from 'fastify';
import { FirewallService, firewallService } from './FirewallService.js';
import { InvalidMacAddressError } from './types.js';

interface MacParams {
  mac?: string;
}

interface MacBody {
  mac?: string;
  reason?: string;
}

export class FirewallController {
  constructor(private readonly service: FirewallService = firewallService) {}

  public getBlockedDevices = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const blocked = await this.service.getBlockedDevices();
    return reply.status(200).send({
      success: true,
      count: blocked.length,
      data: blocked,
      blocked,
    });
  };

  public isBlocked = async (
    request: FastifyRequest<{ Params: MacParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const rawMac = request.params.mac;
    if (!rawMac) {
      throw new InvalidMacAddressError('MAC address parameter is required');
    }
    const isBlocked = await this.service.isBlocked(rawMac);
    const normMac = this.service.validateAndNormalizeMac(rawMac);

    return reply.status(200).send({
      success: true,
      mac: normMac,
      isBlocked,
    });
  };

  public blockDevice = async (
    request: FastifyRequest<{ Params: MacParams; Body: MacBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const rawMac = request.params?.mac ?? request.body?.mac;
    if (!rawMac) {
      throw new InvalidMacAddressError('MAC address is required in route URL or JSON body');
    }

    const result = await this.service.blockDevice(rawMac);
    return reply.status(200).send(result);
  };

  public unblockDevice = async (
    request: FastifyRequest<{ Params: MacParams; Body: MacBody; Querystring: MacParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    const rawMac =
      request.params?.mac ?? request.body?.mac ?? (request.query as MacParams)?.mac;
    if (!rawMac) {
      throw new InvalidMacAddressError('MAC address is required in route URL, query, or JSON body');
    }

    const result = await this.service.unblockDevice(rawMac);
    return reply.status(200).send(result);
  };
}

export const firewallController = new FirewallController();

import type { FastifyPluginAsync } from 'fastify';
import { deviceService, type DeviceService } from './device.service.js';
import { getDevicesQuerySchema } from './device.schemas.js';
import type { GetDevicesResponse } from './device.types.js';

export interface DeviceRoutesOptions {
  service?: DeviceService;
}

export const deviceRoutes: FastifyPluginAsync<DeviceRoutesOptions> = async (fastify, options) => {
  const service = options.service ?? deviceService;

  fastify.get<{
    Querystring: { status?: string; search?: string };
    Reply: GetDevicesResponse;
  }>(
    '/devices',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['online', 'offline', 'idle', 'unknown'] },
            search: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['status', 'count', 'devices'],
            properties: {
              status: { type: 'string', example: 'ok' },
              count: { type: 'number', example: 1 },
              devices: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['mac', 'ip', 'hostname', 'status'],
                  properties: {
                    mac: { type: 'string', example: '52:54:00:12:34:56' },
                    ip: { type: 'string', example: '192.168.50.100' },
                    hostname: { type: 'string', example: 'test-client' },
                    status: { type: 'string', example: 'online' },
                    leaseExpiresAt: { type: 'string', nullable: true },
                    interface: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Validate query string using Zod
      const parsedQuery = getDevicesQuerySchema.parse(request.query);

      const devices = await service.getConnectedDevices(parsedQuery);

      const response: GetDevicesResponse = {
        status: 'ok',
        count: devices.length,
        devices,
      };

      return reply.status(200).send(response);
    }
  );
};

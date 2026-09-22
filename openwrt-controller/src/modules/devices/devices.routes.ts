import type { FastifyPluginAsync } from 'fastify';
import { devicesController, DevicesController } from './DevicesController.js';
import { DevicesService } from './DevicesService.js';

export interface DevicesRoutesOptions {
  controller?: DevicesController;
  service?: DevicesService;
}

export const devicesRoutes: FastifyPluginAsync<DevicesRoutesOptions> = async (fastify, options) => {
  const controller =
    options.controller ??
    (options.service ? new DevicesController(options.service) : devicesController);

  const routeSchema = {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          interface: { type: 'string' },
          connected: { type: 'string', enum: ['true', 'false', '1', '0'] },
          status: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'mac', 'ip', 'hostname', 'connected', 'rxBytes', 'txBytes'],
                properties: {
                  id: { type: 'string', example: '52:54:00:5b:2e:c1' },
                  mac: { type: 'string', example: '52:54:00:5B:2E:C1' },
                  ip: { type: 'string', nullable: true, example: '192.168.50.254' },
                  hostname: { type: 'string', nullable: true, example: 'ubuntu-host' },
                  interface: { type: 'string', nullable: true, example: 'br-lan' },
                  connected: { type: 'boolean', example: true },
                  rxBytes: { type: 'number', example: 0 },
                  txBytes: { type: 'number', example: 0 },
                },
              },
            },
            devices: { type: 'array' },
            count: { type: 'number', example: 1 },
          },
        },
      },
    },
  };

  // Primary API endpoint requested: GET /api/devices
  fastify.get('/api/devices', routeSchema, controller.getDevices);

  // Backward-compatibility endpoint: GET /devices
  fastify.get('/devices', routeSchema, controller.getDevices);
};

// Aliases for backward compatibility
export const deviceRoutes = devicesRoutes;

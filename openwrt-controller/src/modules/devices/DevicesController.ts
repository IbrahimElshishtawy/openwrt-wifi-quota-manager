import type { FastifyRequest, FastifyReply } from 'fastify';
import { devicesService, type DevicesService } from './DevicesService.js';
import { getDevicesQuerySchema } from './device.schemas.js';
import type { DevicesApiResponse } from './types.js';

export class DevicesController {
  constructor(private readonly service: DevicesService = devicesService) {}

  /**
   * Handles GET /api/devices (and GET /devices).
   * Validates query string, delegates to DevicesService, and formats the unified API response.
   */
  public getDevices = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const parsedQuery = getDevicesQuerySchema.parse(request.query);

    const devices = await this.service.getConnectedDevices(parsedQuery);

    const responsePayload: DevicesApiResponse = {
      success: true,
      data: devices,
      devices, // Backward compatibility for existing Flutter clients & tests
      count: devices.length,
    };

    reply.status(200).send(responsePayload);
  };
}

export const devicesController = new DevicesController();
// Aliases for backward compatibility
export const deviceController = devicesController;
export { DevicesController as DeviceController };

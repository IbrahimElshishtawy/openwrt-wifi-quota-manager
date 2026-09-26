import type { FastifyPluginAsync } from 'fastify';
import { firewallController, FirewallController } from './FirewallController.js';
import { FirewallService } from './FirewallService.js';

export interface FirewallRoutesOptions {
  controller?: FirewallController;
  service?: FirewallService;
}

export const firewallRoutes: FastifyPluginAsync<FirewallRoutesOptions> = async (fastify, options) => {
  const controller =
    options.controller ??
    (options.service ? new FirewallController(options.service) : firewallController);

  // --- Primary RESTful Endpoints ---
  // List blocked devices
  fastify.get('/api/blocks', controller.getBlockedDevices);
  fastify.get('/blocks', controller.getBlockedDevices);

  // Check specific device block status
  fastify.get('/api/blocks/:mac', controller.isBlocked);
  fastify.get('/blocks/:mac', controller.isBlocked);

  // Block a device by MAC parameter or payload
  fastify.post('/api/blocks/:mac', controller.blockDevice);
  fastify.post('/blocks/:mac', controller.blockDevice);
  fastify.post('/api/blocks', controller.blockDevice);
  fastify.post('/blocks', controller.blockDevice);

  // Unblock a device by MAC parameter or payload
  fastify.delete('/api/blocks/:mac', controller.unblockDevice);
  fastify.delete('/blocks/:mac', controller.unblockDevice);

  // --- Compatibility & Mobile App Aliases ---
  fastify.get('/api/firewall/blocked', controller.getBlockedDevices);
  fastify.get('/firewall/blocked', controller.getBlockedDevices);
  fastify.get('/api/blocked', controller.getBlockedDevices);
  fastify.get('/blocked', controller.getBlockedDevices);

  fastify.post('/api/block', controller.blockDevice);
  fastify.post('/block', controller.blockDevice);

  fastify.post('/api/unblock', controller.unblockDevice);
  fastify.post('/unblock', controller.unblockDevice);
};

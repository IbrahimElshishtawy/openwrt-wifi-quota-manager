import type { FastifyPluginAsync } from 'fastify';

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['status', 'service', 'timestamp'],
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const body: HealthResponse = {
        status: 'ok',
        service: 'openwrt-controller',
        timestamp: new Date().toISOString(),
      };
      return reply.status(200).send(body);
    }
  );
};

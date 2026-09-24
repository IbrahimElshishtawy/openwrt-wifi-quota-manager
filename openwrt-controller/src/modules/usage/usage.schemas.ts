export const getUsageRouteSchema = {
  schema: {
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
              required: ['mac', 'ip', 'downloadBytes', 'uploadBytes', 'totalBytes'],
              properties: {
                mac: { type: 'string', example: '52:54:00:CE:1C:BE' },
                ip: { type: 'string', example: '192.168.50.50' },
                downloadBytes: { type: 'number', example: 1008 },
                uploadBytes: { type: 'number', example: 1344 },
                totalBytes: { type: 'number', example: 2352 },
              },
            },
          },
          count: { type: 'number', example: 1 },
        },
      },
    },
  },
};

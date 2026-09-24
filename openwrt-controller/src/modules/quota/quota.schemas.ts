import { z } from 'zod';
import { MAC_REGEX } from '../devices/utils/network.utils.js';

export const macAddressParamSchema = z
  .string()
  .regex(MAC_REGEX, 'Invalid MAC address format (must be XX:XX:XX:XX:XX:XX)')
  .transform((val) => val.trim().replace(/-/g, ':').toUpperCase());

export const createQuotaSchema = z.object({
  mac: z
    .string()
    .regex(MAC_REGEX, 'Invalid MAC address format (must be XX:XX:XX:XX:XX:XX)')
    .transform((val) => val.trim().replace(/-/g, ':').toUpperCase()),
  quotaBytes: z
    .number()
    .int('quotaBytes must be an integer')
    .positive('quotaBytes must be a positive integer greater than 0'),
});

export const updateQuotaSchema = z
  .object({
    quotaBytes: z
      .number()
      .int('quotaBytes must be an integer')
      .positive('quotaBytes must be a positive integer greater than 0')
      .optional(),
    resetUsage: z.boolean().optional(),
  })
  .refine(
    (data) => data.quotaBytes !== undefined || data.resetUsage !== undefined,
    {
      message: 'At least one of quotaBytes or resetUsage must be specified for update',
    }
  );

export const macParamsSchema = z.object({
  mac: macAddressParamSchema,
});

export type CreateQuotaInput = z.infer<typeof createQuotaSchema>;
export type UpdateQuotaInput = z.infer<typeof updateQuotaSchema>;
export type MacParamsInput = z.infer<typeof macParamsSchema>;

/**
 * Fastify route validation schemas
 */
const quotaEntitySchema = {
  type: 'object',
  required: ['mac', 'quotaBytes', 'usedBytes', 'remainingBytes', 'percentage', 'status', 'createdAt', 'updatedAt'],
  properties: {
    mac: { type: 'string', example: '52:54:00:CE:1C:BE' },
    quotaBytes: { type: 'number', example: 5368709120 },
    usedBytes: { type: 'number', example: 104857600 },
    remainingBytes: { type: 'number', example: 5263851520 },
    percentage: { type: 'number', example: 1.95 },
    status: { type: 'string', enum: ['active', 'exhausted'], example: 'active' },
    createdAt: { type: 'string', example: '2026-09-24T12:00:00.000Z' },
    updatedAt: { type: 'string', example: '2026-09-24T12:30:00.000Z' },
  },
};

export const createQuotaRouteSchema = {
  schema: {
    body: {
      type: 'object',
      required: ['mac', 'quotaBytes'],
      properties: {
        mac: { type: 'string' },
        quotaBytes: { type: 'number', minimum: 1 },
      },
    },
    response: {
      201: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: quotaEntitySchema,
        },
      },
      200: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: quotaEntitySchema,
        },
      },
    },
  },
};

export const getAllQuotasRouteSchema = {
  schema: {
    response: {
      200: {
        type: 'object',
        required: ['success', 'data', 'count'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'array',
            items: quotaEntitySchema,
          },
          count: { type: 'number', example: 1 },
        },
      },
    },
  },
};

export const getQuotaByMacRouteSchema = {
  schema: {
    params: {
      type: 'object',
      required: ['mac'],
      properties: {
        mac: { type: 'string' },
      },
    },
    response: {
      200: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: quotaEntitySchema,
        },
      },
    },
  },
};

export const updateQuotaRouteSchema = {
  schema: {
    params: {
      type: 'object',
      required: ['mac'],
      properties: {
        mac: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        quotaBytes: { type: 'number', minimum: 1 },
        resetUsage: { type: 'boolean' },
      },
    },
    response: {
      200: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: quotaEntitySchema,
        },
      },
    },
  },
};

export const deleteQuotaRouteSchema = {
  schema: {
    params: {
      type: 'object',
      required: ['mac'],
      properties: {
        mac: { type: 'string' },
      },
    },
    response: {
      200: {
        type: 'object',
        required: ['success', 'message'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Quota removed for device 52:54:00:CE:1C:BE' },
        },
      },
    },
  },
};

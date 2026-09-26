import { z } from 'zod';

export const MAC_REGEX = /^([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})$/;

export const macSchema = z
  .string()
  .trim()
  .regex(MAC_REGEX, {
    message: 'Invalid MAC address format. Expected format: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX',
  });

export const macParamsSchema = z.object({
  mac: macSchema,
});

export const blockDeviceSchema = z.object({
  mac: macSchema.optional(),
  source: z.enum(['manual', 'quota']).optional(),
  reason: z.string().max(255).optional(),
});

export type MacParamsInput = z.infer<typeof macParamsSchema>;
export type BlockDeviceInput = z.infer<typeof blockDeviceSchema>;

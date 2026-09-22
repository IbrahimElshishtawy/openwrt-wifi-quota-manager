import { z } from 'zod';

export const macAddressSchema = z
  .string()
  .regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, 'Invalid MAC address format (must be XX:XX:XX:XX:XX:XX)')
  .transform((val) => val.trim().replace(/-/g, ':').toUpperCase());

export const deviceSchema = z.object({
  id: z.string(),
  mac: z.string(),
  ip: z.string().nullable(),
  hostname: z.string().nullable(),
  interface: z.string().nullable(),
  connected: z.boolean(),
  rxBytes: z.number().int().nonnegative(),
  txBytes: z.number().int().nonnegative(),
});

export const getDevicesQuerySchema = z.object({
  search: z.string().max(100).optional(),
  interface: z.string().max(50).optional(),
  connected: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((val) => (val !== undefined ? val === 'true' || val === '1' : undefined)),
  status: z.string().optional(),
});

export const devicesApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(deviceSchema),
  devices: z.array(deviceSchema).optional(),
  count: z.number().int().nonnegative().optional(),
});

export type GetDevicesQuery = z.infer<typeof getDevicesQuerySchema>;

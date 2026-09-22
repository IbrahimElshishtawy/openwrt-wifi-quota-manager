import { z } from 'zod';

export const macAddressSchema = z
  .string()
  .regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, 'Invalid MAC address format (must be XX:XX:XX:XX:XX:XX)')
  .transform((val) => val.trim().replace(/-/g, ':').toUpperCase());

export const deviceStatusSchema = z.enum(['online', 'offline', 'idle', 'unknown']);

export const connectedDeviceSchema = z.object({
  mac: z.string().regex(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/),
  ip: z.ipv4(),
  hostname: z.string(),
  status: deviceStatusSchema,
  leaseExpiresAt: z.string().nullable().optional(),
  interface: z.string().nullable().optional(),
});

export const getDevicesQuerySchema = z.object({
  status: deviceStatusSchema.optional(),
  search: z.string().max(100).optional(),
});

export const getDevicesResponseSchema = z.object({
  status: z.literal('ok'),
  count: z.number().int().nonnegative(),
  devices: z.array(connectedDeviceSchema),
});

export type GetDevicesQuery = z.infer<typeof getDevicesQuerySchema>;

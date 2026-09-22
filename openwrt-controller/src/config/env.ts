import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from .env file into process.env
dotenv.config();

/**
 * Environment configuration schema.
 * OpenWrt connection variables are marked optional so that the server
 * can start up cleanly before router credentials have been provided.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default('*'),

  // OpenWrt connection parameters (prepared for Phase 2, optional during startup)
  OPENWRT_HOST: z.string().optional(),
  OPENWRT_PORT: z.coerce.number().int().min(1).max(65535).default(80),
  OPENWRT_USERNAME: z.string().optional(),
  OPENWRT_PASSWORD: z.string().optional(),
  OPENWRT_USE_HTTPS: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((val) => val === 'true' || val === '1'),
});

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment validation failed:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env: Env = parsedEnv.data;

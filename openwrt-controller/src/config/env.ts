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

  // OpenWrt SSH parameters for router shell commands (e.g. nlbw, nftables)
  OPENWRT_SSH_PORT: z.coerce.number().int().min(1).max(65535).default(22),
  OPENWRT_SSH_USER: z.string().default('root'),
  OPENWRT_SSH_KEY_PATH: z.string().optional(),
  OPENWRT_SSH_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),

  // Quota persistence configuration
  QUOTA_STORAGE_PATH: z.string().default('data/quotas.json'),

  // Quota enforcement configuration
  QUOTA_ENFORCEMENT_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((val) => val === 'true' || val === '1'),
  QUOTA_ENFORCEMENT_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  FIREWALL_STORAGE_PATH: z.string().default('data/firewall-blocks.json'),
});

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment validation failed:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env: Env = parsedEnv.data;

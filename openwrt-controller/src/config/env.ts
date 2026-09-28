import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from .env file into process.env
dotenv.config();

export const INSECURE_CREDENTIALS = new Set([
  'change_me',
  'password',
  'secret',
  'admin',
  '123456',
  '12345678',
  'root',
  'test',
  'qwerty',
  'default',
]);

/**
 * Environment configuration schema.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default('*'),

  // API Authentication Token (mandatory in production)
  API_AUTH_TOKEN: z.string().optional(),
  ADMIN_API_TOKEN: z.string().optional(), // Alias

  // Rate Limiting configuration
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),

  // OpenWrt connection parameters
  OPENWRT_HOST: z.string().optional(),
  OPENWRT_PORT: z.coerce.number().int().min(1).max(65535).default(80),
  OPENWRT_USERNAME: z.string().optional(),
  OPENWRT_PASSWORD: z.string().optional(),
  OPENWRT_USE_HTTPS: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((val) => val === 'true' || val === '1'),

  // OpenWrt SSH parameters for router shell commands (nlbwmon, nftables)
  OPENWRT_SSH_PORT: z.coerce.number().int().min(1).max(65535).default(22),
  OPENWRT_SSH_USER: z.string().default('root'),
  OPENWRT_SSH_KEY_PATH: z.string().optional(),
  OPENWRT_SSH_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),

  // Circuit breaker settings
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(3),
  CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1000).default(10000),

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

/**
 * Validates configuration against strict production security standards.
 * Returns an array of error messages (empty if valid).
 */
export function validateProductionConfig(config: Env): string[] {
  const errors: string[] = [];

  if (config.NODE_ENV !== 'production') {
    return errors;
  }

  // 1. OpenWrt Router Host & Credentials
  if (!config.OPENWRT_HOST || config.OPENWRT_HOST.trim().length === 0) {
    errors.push('OPENWRT_HOST is required in production');
  }

  if (!config.OPENWRT_USERNAME || config.OPENWRT_USERNAME.trim().length === 0) {
    errors.push('OPENWRT_USERNAME is required in production');
  }

  const effectivePassword = config.OPENWRT_PASSWORD?.trim().toLowerCase() ?? '';
  if (!config.OPENWRT_SSH_KEY_PATH && !effectivePassword) {
    errors.push('Either OPENWRT_PASSWORD or OPENWRT_SSH_KEY_PATH must be provided in production');
  } else if (effectivePassword && INSECURE_CREDENTIALS.has(effectivePassword)) {
    errors.push(`OPENWRT_PASSWORD cannot be an insecure default ("${config.OPENWRT_PASSWORD}") in production`);
  }

  // 2. API Authentication Token
  const effectiveApiToken = (config.API_AUTH_TOKEN ?? config.ADMIN_API_TOKEN)?.trim() ?? '';
  if (!effectiveApiToken) {
    errors.push('API_AUTH_TOKEN (or ADMIN_API_TOKEN) is mandatory in production');
  } else if (effectiveApiToken.length < 16) {
    errors.push('API_AUTH_TOKEN must be at least 16 characters in production');
  } else if (INSECURE_CREDENTIALS.has(effectiveApiToken.toLowerCase())) {
    errors.push(`API_AUTH_TOKEN cannot be an insecure default ("${effectiveApiToken}") in production`);
  }

  // 3. CORS Configuration
  if (config.CORS_ORIGIN === '*' || !config.CORS_ORIGIN || config.CORS_ORIGIN.trim().length === 0) {
    errors.push('Wildcard CORS_ORIGIN="*" is prohibited in production; specify explicit allowed origins');
  }

  // 4. Rate Limiting Configuration
  if (config.API_RATE_LIMIT_MAX < 5) {
    errors.push('API_RATE_LIMIT_MAX must be at least 5 in production');
  }
  if (config.API_RATE_LIMIT_WINDOW_MS < 1000) {
    errors.push('API_RATE_LIMIT_WINDOW_MS must be at least 1000ms in production');
  }

  // 5. Quota Enforcement & Resilience
  if (config.QUOTA_ENFORCEMENT_INTERVAL_MS < 1000) {
    errors.push('QUOTA_ENFORCEMENT_INTERVAL_MS must be at least 1000ms in production');
  }
  if (config.CIRCUIT_BREAKER_FAILURE_THRESHOLD < 1) {
    errors.push('CIRCUIT_BREAKER_FAILURE_THRESHOLD must be at least 1 in production');
  }
  if (config.CIRCUIT_BREAKER_COOLDOWN_MS < 1000) {
    errors.push('CIRCUIT_BREAKER_COOLDOWN_MS must be at least 1000ms in production');
  }

  return errors;
}

export function parseAndValidateEnv(rawEnv: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    console.error('❌ Environment schema validation failed:');
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    if (rawEnv.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw new Error('Environment schema validation failed');
  }

  const data = parsed.data;

  // In production, enforce zero insecure defaults
  if (data.NODE_ENV === 'production') {
    const prodErrors = validateProductionConfig(data);
    if (prodErrors.length > 0) {
      console.error('❌ Production configuration validation failed:');
      for (const err of prodErrors) {
        console.error(`  - ${err}`);
      }
      if (rawEnv.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw new Error(`Production configuration validation failed: ${prodErrors.join('; ')}`);
    }
  }

  return data;
}

export const env: Env = parseAndValidateEnv(process.env);

import type { FastifyRequest, FastifyReply, onRequestHookHandler } from 'fastify';
import { env } from '../../config/env.js';

export interface RateLimitOptions {
  enabled?: boolean | undefined;
  max?: number | undefined;
  windowMs?: number | undefined;
  writeMax?: number | undefined;
  exemptRoutes?: string[] | undefined;
}

interface ClientBucket {
  count: number;
  resetAt: number;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_EXEMPT_ROUTES = new Set([
  '/health',
  '/api/health',
  '/health/live',
  '/api/health/live',
  '/health/ready',
  '/api/health/ready',
  '/metrics',
  '/api/metrics',
]);

export class MemoryRateLimiter {
  private readonly clients = new Map<string, ClientBucket>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly writeMaxRequests: number
  ) {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, Math.max(10000, windowMs));

    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  public check(ip: string, isWrite: boolean): { allowed: boolean; limit: number; remaining: number; resetTimeSec: number } {
    const now = Date.now();
    const effectiveMax = isWrite ? this.writeMaxRequests : this.maxRequests;
    const bucketKey = isWrite ? `${ip}:write` : `${ip}:read`;

    let bucket = this.clients.get(bucketKey);

    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 1,
        resetAt: now + this.windowMs,
      };
      this.clients.set(bucketKey, bucket);

      return {
        allowed: true,
        limit: effectiveMax,
        remaining: Math.max(0, effectiveMax - 1),
        resetTimeSec: Math.ceil(bucket.resetAt / 1000),
      };
    }

    bucket.count++;
    const remaining = Math.max(0, effectiveMax - bucket.count);
    const resetTimeSec = Math.ceil(bucket.resetAt / 1000);

    return {
      allowed: bucket.count <= effectiveMax,
      limit: effectiveMax,
      remaining,
      resetTimeSec,
    };
  }

  public reset(): void {
    this.clients.clear();
  }

  public close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clients.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.clients.entries()) {
      if (now >= bucket.resetAt) {
        this.clients.delete(key);
      }
    }
  }
}

/**
 * Creates the rate limiting onRequest hook handler and its underlying limiter.
 */
export function createRateLimitHook(options: RateLimitOptions = {}): {
  hook: onRequestHookHandler;
  limiter: MemoryRateLimiter;
} {
  const isEnabled = options.enabled ?? (env.NODE_ENV !== 'test');
  const windowMs = options.windowMs ?? env.API_RATE_LIMIT_WINDOW_MS ?? 60000;
  const max = options.max ?? env.API_RATE_LIMIT_MAX ?? 100;
  const writeMax = options.writeMax ?? Math.max(5, Math.floor(max / 2));
  const exemptRoutes = new Set(options.exemptRoutes ?? Array.from(DEFAULT_EXEMPT_ROUTES));

  const limiter = new MemoryRateLimiter(max, windowMs, writeMax);

  const hook: onRequestHookHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isEnabled) {
      return;
    }

    const path = request.url.split('?')[0] ?? '';

    // Health endpoints must never be throttled
    if (exemptRoutes.has(path)) {
      return;
    }

    const isWrite = WRITE_METHODS.has(request.method.toUpperCase());
    const ip = request.ip || '127.0.0.1';

    const result = limiter.check(ip, isWrite);

    // Standard rate limit telemetry headers
    reply.header('X-RateLimit-Limit', result.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetTimeSec);

    if (!result.allowed) {
      reply.header('Retry-After', Math.max(1, Math.ceil(windowMs / 1000)));

      request.log.warn({
        ip,
        method: request.method,
        url: request.url,
        requestId: request.id,
      }, 'Rate limit exceeded');

      return reply.status(429).send({
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please slow down and try again later',
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please slow down and try again later',
          requestId: request.id,
        },
        success: false,
        requestId: request.id,
      });
    }
  };

  return { hook, limiter };
}

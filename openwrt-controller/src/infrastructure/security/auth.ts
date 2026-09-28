import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply, onRequestHookHandler } from 'fastify';
import { env } from '../../config/env.js';

export interface AuthOptions {
  enabled?: boolean | undefined;
  token?: string | undefined;
  exemptRoutes?: string[] | undefined;
  protectReads?: boolean | undefined;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_EXEMPT_ROUTES = new Set(['/health', '/api/health']);

/**
 * Constant-time comparison between provided and expected tokens to mitigate timing attacks.
 */
export function safeTokenCompare(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }
  const bufProvided = Buffer.from(provided);
  const bufExpected = Buffer.from(expected);

  if (bufProvided.length !== bufExpected.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Extracts authentication token from Bearer header or api-key headers.
 */
export function extractAuthToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.trim().split(' ');
    const scheme = parts[0];
    const token = parts[1];
    if (parts.length === 2 && scheme && /^bearer$/i.test(scheme) && token) {
      return token;
    }
  }

  const apiKeyHeader = request.headers['x-api-key'] ?? request.headers['x-admin-token'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string') {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 * Creates the central authentication onRequest hook.
 * Protects state-modifying (WRITE) routes and admin endpoints with administrative Bearer token.
 * Health endpoints remain accessible for orchestrator and monitoring liveness probes.
 */
export function createAuthHook(options: AuthOptions = {}): onRequestHookHandler {
  const isAuthEnabled =
    options.enabled ?? (env.NODE_ENV === 'production' || Boolean(env.API_AUTH_TOKEN ?? env.ADMIN_API_TOKEN));
  const expectedToken = options.token ?? env.API_AUTH_TOKEN ?? env.ADMIN_API_TOKEN;
  const exemptRoutes = new Set(options.exemptRoutes ?? Array.from(DEFAULT_EXEMPT_ROUTES));
  const protectReads = options.protectReads ?? false;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // If auth is disabled (e.g. standard local development or test without token configured), allow
    if (!isAuthEnabled) {
      return;
    }

    const path = request.url.split('?')[0] ?? '';

    // Always permit public health check endpoints
    if (exemptRoutes.has(path)) {
      return;
    }

    const isWrite = WRITE_METHODS.has(request.method.toUpperCase());

    // In production/configured auth: all write operations require auth. If protectReads is true, reads require auth as well.
    if (!isWrite && !protectReads) {
      return;
    }

    if (!expectedToken) {
      request.log.error('API authentication is enabled but no API_AUTH_TOKEN is configured');
      return reply.status(500).send({
        statusCode: 500,
        error: {
          code: 'AUTH_MISCONFIGURED',
          message: 'Server authentication misconfigured',
          requestId: request.id,
        },
        success: false,
      });
    }

    const providedToken = extractAuthToken(request);

    if (!providedToken) {
      return reply.status(401).send({
        statusCode: 401,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing authorization token. Provide via "Authorization: Bearer <TOKEN>" or "x-api-key" header.',
          requestId: request.id,
        },
        success: false,
      });
    }

    const isValid = safeTokenCompare(providedToken, expectedToken);

    if (!isValid) {
      request.log.warn({
        ip: request.ip,
        method: request.method,
        url: request.url,
        requestId: request.id,
      }, 'Unauthorized request: invalid API token attempt');

      return reply.status(401).send({
        statusCode: 401,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API authorization token',
          requestId: request.id,
        },
        success: false,
      });
    }
  };
}

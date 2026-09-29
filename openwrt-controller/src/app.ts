import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyError,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import {
  createSecurityHeadersHook,
  createRateLimitHook,
  createAuthHook,
} from './infrastructure/security/index.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { devicesRoutes } from './modules/devices/devices.routes.js';
import {
  OpenWrtConnectionError,
  UbusAuthenticationError,
  UbusRequestError,
  OpenWrtNotConfiguredError,
} from './infrastructure/openwrt/UbusClient.js';
import { DeviceFetchError } from './modules/devices/DevicesService.js';
import { usageRoutes } from './modules/usage/usage.routes.js';
import { UsageFetchError } from './modules/usage/UsageService.js';
import { quotaRoutes } from './modules/quota/quota.routes.js';
import {
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
  QuotaStorageError,
} from './modules/quota/types.js';
import { firewallRoutes } from './modules/firewall/firewall.routes.js';
import {
  FirewallError,
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
  FirewallExecutionError,
} from './modules/firewall/types.js';
import { ForbiddenFirewallOperationError } from './modules/firewall/NftablesSafetyGuard.js';
import { quotaEnforcementRoutes } from './modules/quota-enforcement/quota-enforcement.routes.js';
import { quotaEnforcementMonitor } from './modules/quota/QuotaEnforcementMonitor.js';
import { createHttpMetricsHooks } from './infrastructure/metrics/httpMetricsHook.js';
import { metricsRoutes } from './infrastructure/metrics/metrics.routes.js';
import { operationsRoutes } from './modules/operations/operations.routes.js';

export interface StandardErrorObject {
  code: string;
  message: string;
  requestId: string;
  name?: string | undefined;
  issues?: unknown;
}

export interface ErrorResponse {
  statusCode: number;
  error: StandardErrorObject | string;
  message: string;
  code?: string;
  name?: string | undefined;
  success: boolean;
  requestId?: string;
  issues?: unknown;
}

export interface AppOptions {
  authEnabled?: boolean | undefined;
  apiToken?: string | undefined;
  rateLimitEnabled?: boolean | undefined;
  rateLimitMax?: number | undefined;
  rateLimitWindowMs?: number | undefined;
  protectReads?: boolean | undefined;
}

const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Fastify application factory.
 * Configures request correlation, security headers, rate limiting, authentication,
 * strict request size limits, CORS, logger secret redaction, and standardized error handling.
 */
export const buildApp = async (options: AppOptions = {}): Promise<FastifyInstance> => {
  const isProduction = env.NODE_ENV === 'production';

  const app = Fastify({
    // Strict request size limit to prevent memory exhaustion / DoS
    bodyLimit: 64 * 1024, // 64 KB

    // Request correlation ID generator supporting valid incoming X-Request-Id or UUID
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && REQUEST_ID_REGEX.test(incoming.trim())) {
        return incoming.trim();
      }
      return randomUUID();
    },

    logger: {
      level: isProduction ? 'info' : 'debug',
      // Strict redaction of secrets, tokens, credentials, and sensitive headers in logs
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers["x-admin-token"]',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.secret',
          'req.body.key',
          '*.password',
          '*.token',
          '*.secret',
          '*.key',
          'password',
          'token',
          'secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  // 0. HTTP Metrics Tracking Hook (Prometheus & Operations Observability)
  const httpMetricsHooks = createHttpMetricsHooks();
  app.addHook('onRequest', httpMetricsHooks.onRequest);
  app.addHook('onResponse', httpMetricsHooks.onResponse);

  // Always echo X-Request-Id in response headers
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });

  // 1. Global Security Headers Hook
  app.addHook('onSend', createSecurityHeadersHook());

  // 2. Global Rate Limiting Hook
  const { hook: rateLimitHook, limiter } = createRateLimitHook({
    enabled: options.rateLimitEnabled,
    max: options.rateLimitMax,
    windowMs: options.rateLimitWindowMs,
  });
  app.addHook('onRequest', rateLimitHook);
  app.addHook('onClose', async () => {
    limiter.close();
  });

  // 3. CORS Configuration
  const allowedOrigins =
    env.CORS_ORIGIN === '*'
      ? isProduction
        ? false // In production, reject wildcard origin
        : true
      : env.CORS_ORIGIN.split(',').map((o) => o.trim());

  await app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // 4. Global Authentication Hook
  app.addHook(
    'onRequest',
    createAuthHook({
      enabled: options.authEnabled,
      token: options.apiToken,
      protectReads: options.protectReads,
    })
  );

  // Centralized Fastify error handling returning standardized format
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent) {
      return;
    }

    const requestId = request.id;

    // 1. Handle Zod input validation errors
    if (error instanceof ZodError) {
      const clientMessage = 'Validation failed';
      const statusCode = 400;
      const errorObj: StandardErrorObject = {
        code: 'VALIDATION_ERROR',
        message: clientMessage,
        requestId,
        issues: error.issues,
      };

      return reply.status(statusCode).send({
        statusCode,
        error: errorObj,
        message: clientMessage,
        code: 'VALIDATION_ERROR',
        success: false,
        requestId,
        issues: error.issues,
      });
    }

    // 2. Handle Oversized Body errors (FST_ERR_CTP_BODY_TOO_LARGE)
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      const statusCode = 413;
      const clientMessage = 'Payload too large. Maximum allowed size is 64KB';
      const errorObj: StandardErrorObject = {
        code: 'PAYLOAD_TOO_LARGE',
        message: clientMessage,
        requestId,
      };

      return reply.status(statusCode).send({
        statusCode,
        error: errorObj,
        message: clientMessage,
        code: 'PAYLOAD_TOO_LARGE',
        success: false,
        requestId,
      });
    }

    // 3. Handle Domain errors (OpenWrt, Firewall, Quota, Ubus)
    if (
      error instanceof OpenWrtConnectionError ||
      error instanceof UbusAuthenticationError ||
      error instanceof UbusRequestError ||
      error instanceof OpenWrtNotConfiguredError ||
      error instanceof DeviceFetchError ||
      error instanceof UsageFetchError ||
      error instanceof QuotaNotFoundError ||
      error instanceof QuotaAlreadyExistsError ||
      error instanceof InvalidDeviceQuotaError ||
      error instanceof QuotaStorageError ||
      error instanceof InvalidMacAddressError ||
      error instanceof InfrastructureDeviceError ||
      error instanceof NonClientDeviceError ||
      error instanceof FirewallError ||
      error instanceof FirewallExecutionError ||
      error instanceof ForbiddenFirewallOperationError
    ) {
      const statusCode = (error as { statusCode?: number }).statusCode || 502;
      const errorCode = (error as { code?: string }).code || error.name || 'DOMAIN_ERROR';
      const clientMessage = error.message;

      request.log.error({
        err: error,
        requestId,
        statusCode,
        code: errorCode,
      }, error.message);

      const errorObj: StandardErrorObject = {
        code: errorCode,
        name: error.name,
        message: clientMessage,
        requestId,
      };

      return reply.status(statusCode).send({
        statusCode,
        error: errorObj,
        name: error.name,
        code: errorCode,
        message: clientMessage,
        success: false,
        requestId,
      });
    }

    // 4. General HTTP and 5xx errors
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    request.log.error({
      err: error,
      requestId,
      statusCode,
    }, error.message);

    const is5xx = statusCode >= 500;
    const errorCode = error.code || (is5xx ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
    // In production, do not leak internal exception details for 5xx errors
    const clientMessage =
      isProduction && is5xx ? 'An internal server error occurred' : error.message;

    const errorObj: StandardErrorObject = {
      code: errorCode,
      message: clientMessage,
      requestId,
    };

    return reply.status(statusCode).send({
      statusCode,
      error: errorObj,
      code: errorCode,
      message: clientMessage,
      success: false,
      requestId,
    });
  });

  // Centralized 404 handler returning standard JSON error structure
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const message = `Route ${request.method} ${request.url} not found`;
    const notFoundPayload: ErrorResponse = {
      statusCode: 404,
      error: {
        code: 'NOT_FOUND',
        message,
        requestId,
      },
      message,
      code: 'NOT_FOUND',
      success: false,
      requestId,
    };

    return reply.status(404).send(notFoundPayload);
  });

  // Register modular routes
  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(operationsRoutes);
  await app.register(devicesRoutes);
  await app.register(usageRoutes);
  await app.register(quotaRoutes);
  await app.register(firewallRoutes);
  await app.register(quotaEnforcementRoutes, { monitor: quotaEnforcementMonitor });

  // Stop background monitor upon application close
  app.addHook('onClose', async () => {
    quotaEnforcementMonitor.stop();
  });

  return app;
};

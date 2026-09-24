import Fastify, {
  type FastifyInstance,
  type FastifyError,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env } from './config/env.js';
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

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  success?: boolean;
}

/**
 * Fastify application factory.
 * Configures CORS, built-in logging with secret redaction,
 * centralized error handling, and registers modular routes.
 */
export const buildApp = async (): Promise<FastifyInstance> => {
  const isProduction = env.NODE_ENV === 'production';

  const app = Fastify({
    logger: {
      level: isProduction ? 'info' : 'debug',
      // Strict redaction of secrets, tokens, and credentials in logs
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.secret',
          '*.password',
          '*.token',
          '*.secret',
          'password',
          'token',
          'secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  // Enable CORS
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Centralized Fastify error handling
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // Handle Zod input validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: error.issues,
      });
    }

    // Handle OpenWrt router and Ubus domain errors
    if (
      error instanceof OpenWrtConnectionError ||
      error instanceof UbusAuthenticationError ||
      error instanceof UbusRequestError ||
      error instanceof OpenWrtNotConfiguredError ||
      error instanceof DeviceFetchError ||
      error instanceof UsageFetchError
    ) {
      const statusCode = error.statusCode || 502;
      request.log.error(error);
      return reply.status(statusCode).send({
        statusCode,
        error: error.name,
        code: (error as { code?: string }).code,
        message: error.message,
        success: false,
      });
    }

    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    // Log internally for debugging, keeping production responses clean
    request.log.error(error);

    const is5xx = statusCode >= 500;

    const errorPayload: ErrorResponse = {
      statusCode,
      error: error.name || (is5xx ? 'Internal Server Error' : 'Bad Request'),
      // In production, do not leak internal exception details for 5xx errors
      message: isProduction && is5xx ? 'An internal server error occurred' : error.message,
      success: false,
    };

    return reply.status(statusCode).send(errorPayload);
  });

  // Centralized 404 handler returning standard JSON error structure
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const notFoundPayload: ErrorResponse = {
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      success: false,
    };

    return reply.status(404).send(notFoundPayload);
  });

  // Register modular routes
  await app.register(healthRoutes);
  await app.register(devicesRoutes);
  await app.register(usageRoutes);

  return app;
};

import type { onSendHookHandler } from 'fastify';
import { env } from '../../config/env.js';

export function createSecurityHeadersHook(): onSendHookHandler {
  const isProduction = env.NODE_ENV === 'production';

  return async (_request, reply, payload) => {
    // 1. Prevent MIME-type sniffing
    reply.header('X-Content-Type-Options', 'nosniff');

    // 2. Prevent clickjacking / frame embedding
    reply.header('X-Frame-Options', 'DENY');

    // 3. Modern XSS filter settings (disable legacy auditor)
    reply.header('X-XSS-Protection', '0');

    // 4. Content Security Policy (strict REST API CSP)
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // 5. Referrer Policy
    reply.header('Referrer-Policy', 'no-referrer');

    // 6. Cross-Origin policies
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');

    // 7. Strict-Transport-Security in production
    if (isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // 8. Prevent browser cache for sensitive API responses
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');

    return payload;
  };
}

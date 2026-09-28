import { buildApp } from './app.js';
import { env } from './config/env.js';
import { firewallService } from './modules/firewall/FirewallService.js';
import { quotaEnforcementMonitor } from './modules/quota/QuotaEnforcementMonitor.js';
import { GracefulShutdownHandler } from './infrastructure/shutdown/GracefulShutdown.js';

const startServer = async (): Promise<void> => {
  // 1. Create app
  const app = await buildApp();

  app.log.info(
    {
      nodeEnv: env.NODE_ENV,
      authEnabled: env.NODE_ENV === 'production' || Boolean(env.API_AUTH_TOKEN ?? env.ADMIN_API_TOKEN),
      corsOrigin: env.CORS_ORIGIN,
      rateLimitMax: env.API_RATE_LIMIT_MAX,
    },
    'Configuration validated and security posture active'
  );

  // 2. Initialize firewall enforcement
  try {
    app.log.info('Initializing firewall enforcement ruleset on OpenWrt...');
    await firewallService.initialize();
    app.log.info('Firewall enforcement ruleset verified/initialized successfully');
  } catch (firewallErr) {
    app.log.warn(
      firewallErr,
      'Firewall initialization warning: unable to connect or initialize nftables on router right now. Monitor will retry on each sync.'
    );
  }

  // 3. Start Quota Enforcement Monitor & Reconcile Quotas with Actual nftables State
  if (env.QUOTA_ENFORCEMENT_ENABLED && env.NODE_ENV !== 'test') {
    try {
      app.log.info('[QuotaRecovery] Starting QuotaEnforcementMonitor with startup reconciliation...');
      await quotaEnforcementMonitor.start();
      app.log.info('[QuotaRecovery] QuotaEnforcementMonitor started and startup reconciliation completed successfully');
    } catch (recoveryErr) {
      app.log.warn(
        recoveryErr,
        '[QuotaRecovery] Initial recovery warning: unable to complete startup reconciliation. Periodic monitor will retry.'
      );
    }
  }

  // 4. Configure robust graceful shutdown handler
  const shutdownHandler = new GracefulShutdownHandler(app, quotaEnforcementMonitor, {
    timeoutMs: 5000,
    logger: {
      info: (msg) => app.log.info(msg),
      error: (msg, err) => app.log.error(err, msg),
    },
  });
  shutdownHandler.registerSignals(['SIGINT', 'SIGTERM']);

  // 5. Start HTTP server
  try {
    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    app.log.info(
      {
        host: env.HOST,
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
      },
      `🚀 OpenWrt Controller server listening at ${address}`
    );
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
};

void startServer();

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { APP_VERSION } from './version.js';
import { firewallService } from './modules/firewall/FirewallService.js';
import { quotaEnforcementMonitor } from './modules/quota/QuotaEnforcementMonitor.js';
import { GracefulShutdownHandler } from './infrastructure/shutdown/GracefulShutdown.js';
import { logger } from './infrastructure/logging/Logger.js';

const startServer = async (): Promise<void> => {
  // 1. Create app
  const app = await buildApp();

  logger.info(`OpenWrt Controller v${APP_VERSION} starting (env: ${env.NODE_ENV})...`);

  // 2. Initialize firewall enforcement
  try {
    logger.info('Initializing firewall enforcement ruleset on OpenWrt...');
    await firewallService.initialize();
    logger.info('Firewall enforcement ruleset verified/initialized successfully');
  } catch {
    logger.warn('Firewall: OpenWrt router is currently unreachable via SSH. Monitor will retry automatically.');
  }

  // 3. Start Quota Enforcement Monitor & Reconcile Quotas with Actual nftables State
  if (env.QUOTA_ENFORCEMENT_ENABLED && env.NODE_ENV !== 'test') {
    try {
      logger.info('Starting QuotaEnforcementMonitor with startup reconciliation...');
      await quotaEnforcementMonitor.start();
    } catch {
      logger.warn('Startup reconciliation: OpenWrt router unreachable. Monitor will retry automatically.');
    }
  }

  // 4. Configure robust graceful shutdown handler
  const shutdownHandler = new GracefulShutdownHandler(app, quotaEnforcementMonitor, {
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    logger: {
      info: (msg) => logger.info(msg),
      error: (msg, err) => logger.error(msg, { error: err }),
    },
  });
  shutdownHandler.registerSignals(['SIGINT', 'SIGTERM']);

  // 5. Start HTTP server
  try {
    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    logger.info(`🚀 OpenWrt Controller v${APP_VERSION} listening at ${address}`);
  } catch (err) {
    logger.error('Failed to start server', { error: err });
    process.exit(1);
  }
};

void startServer();

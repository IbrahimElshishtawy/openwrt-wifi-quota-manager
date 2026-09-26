import { buildApp } from './app.js';
import { env } from './config/env.js';
import { firewallService } from './modules/firewall/FirewallService.js';
import { quotaEnforcementMonitor } from './modules/quota/QuotaEnforcementMonitor.js';

const startServer = async (): Promise<void> => {
  // 1. Create app
  const app = await buildApp();

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

  // 3. Start Quota Enforcement Monitor
  if (env.QUOTA_ENFORCEMENT_ENABLED && env.NODE_ENV !== 'test') {
    quotaEnforcementMonitor.start();
  }

  // 4. Start HTTP server
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

  // Graceful shutdown handling
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        quotaEnforcementMonitor.stop();
        await app.close();
        app.log.info('Server closed successfully');
        process.exit(0);
      } catch (closeErr) {
        app.log.error(closeErr, 'Error while closing server');
        process.exit(1);
      }
    });
  }
};

void startServer();

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { quotaEnforcementMonitor } from './modules/quota-enforcement/QuotaEnforcementMonitor.js';

const startServer = async (): Promise<void> => {
  const app = await buildApp();

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

    // Start background Quota Enforcement Monitor
    quotaEnforcementMonitor.start();
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

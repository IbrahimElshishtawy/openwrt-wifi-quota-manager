import type { FastifyInstance } from 'fastify';
import type { IQuotaEnforcementMonitor } from '../../modules/quota/QuotaEnforcementMonitor.js';

export interface ShutdownOptions {
  timeoutMs?: number;
  logger?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
}

export class GracefulShutdownHandler {
  private isShuttingDown = false;
  private readonly app: FastifyInstance;
  private readonly monitor?: IQuotaEnforcementMonitor;
  private readonly timeoutMs: number;
  private readonly logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };

  constructor(
    app: FastifyInstance,
    monitor?: IQuotaEnforcementMonitor,
    options: ShutdownOptions = {}
  ) {
    this.app = app;
    this.monitor = monitor;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.logger = options.logger ?? {
      info: (msg) => console.log(`[Shutdown] ${msg}`),
      error: (msg, err) => console.error(`[Shutdown] ${msg}`, err),
    };
  }

  public registerSignals(signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']): void {
    for (const signal of signals) {
      process.on(signal, () => {
        void this.shutdown(signal);
      });
    }
  }

  public async shutdown(signal?: string): Promise<boolean> {
    if (this.isShuttingDown) {
      return false; // Idempotent: already in progress
    }
    this.isShuttingDown = true;

    this.logger.info(`Received ${signal ?? 'shutdown'}, terminating gracefully...`);

    const shutdownTimer = setTimeout(() => {
      this.logger.error(`Graceful shutdown timed out after ${this.timeoutMs}ms, forcing exit`);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }, this.timeoutMs);

    if (typeof shutdownTimer.unref === 'function') {
      shutdownTimer.unref();
    }

    try {
      // 1. Stop quota monitor cleanly and await any active in-flight cycle
      if (this.monitor) {
        if ('stop' in this.monitor && typeof (this.monitor as { stop: (opts?: unknown) => Promise<void> | void }).stop === 'function') {
          await (this.monitor as { stop: (opts?: unknown) => Promise<void> | void }).stop({
            waitForCycle: true,
            timeoutMs: Math.min(3000, this.timeoutMs),
          });
        }
      }

      // 2. Close Fastify application (stops accepting new requests, drains existing connections)
      await this.app.close();

      this.logger.info('Server and background monitors closed cleanly');
      clearTimeout(shutdownTimer);
      return true;
    } catch (err: unknown) {
      this.logger.error('Error occurred during graceful shutdown', err);
      clearTimeout(shutdownTimer);
      throw err;
    }
  }

  public isInProgress(): boolean {
    return this.isShuttingDown;
  }
}

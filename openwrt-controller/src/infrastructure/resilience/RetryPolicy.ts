import type { RetryOptions } from './resilience.types.js';
import {
  InvalidMacAddressError,
  InfrastructureDeviceError,
  NonClientDeviceError,
} from '../../modules/firewall/types.js';
import {
  QuotaNotFoundError,
  QuotaAlreadyExistsError,
  InvalidDeviceQuotaError,
} from '../../modules/quota/types.js';
import { OpenWrtNotConfiguredError } from '../openwrt/UbusClient.js';

export class RetryPolicy {
  public static isSafeToRetry(error: unknown): boolean {
    if (
      error instanceof InvalidMacAddressError ||
      error instanceof InfrastructureDeviceError ||
      error instanceof NonClientDeviceError ||
      error instanceof QuotaNotFoundError ||
      error instanceof QuotaAlreadyExistsError ||
      error instanceof InvalidDeviceQuotaError ||
      error instanceof OpenWrtNotConfiguredError
    ) {
      return false;
    }
    return true;
  }

  public async execute<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 3;
    const initialDelayMs = options.initialDelayMs ?? 100;
    const backoffFactor = options.backoffFactor ?? 2;
    const maxDelayMs = options.maxDelayMs ?? 1000;
    const shouldRetryFn = options.shouldRetry ?? RetryPolicy.isSafeToRetry;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (err: unknown) {
        lastError = err;

        if (attempt >= maxAttempts || !shouldRetryFn(err, attempt)) {
          throw err;
        }

        const delay = Math.min(
          maxDelayMs,
          Math.floor(initialDelayMs * Math.pow(backoffFactor, attempt - 1))
        );

        if (options.onRetry) {
          options.onRetry(err, attempt, delay);
        }

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const retryPolicy = new RetryPolicy();

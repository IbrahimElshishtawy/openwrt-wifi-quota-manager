export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number | undefined;
  cooldownPeriodMs?: number | undefined;
  successThreshold?: number | undefined;
  onStateChange?: ((from: CircuitState, to: CircuitState) => void) | undefined;
}

export class CircuitBreakerOpenError extends Error {
  public readonly code = 'CIRCUIT_BREAKER_OPEN';
  constructor(message = 'Circuit breaker is OPEN: operations temporarily suppressed') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

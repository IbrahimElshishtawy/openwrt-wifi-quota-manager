import {
  type CircuitState,
  type CircuitBreakerOptions,
  CircuitBreakerOpenError,
} from './resilience.types.js';
import { metricsService } from '../metrics/MetricsService.js';
import { logger } from '../logging/Logger.js';

export { CircuitBreakerOpenError };

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastStateChangeTime: number = Date.now();
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastErrorMessage: string | null = null;

  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private readonly successThreshold: number;
  private readonly onStateChange: ((from: CircuitState, to: CircuitState) => void) | undefined;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 10000;
    this.successThreshold = options.successThreshold ?? 1;
    this.onStateChange = options.onStateChange;

    // Initialize state gauge (0 = CLOSED)
    metricsService.set('resilience_circuit_breaker_state', 0);
  }

  public getState(): CircuitState {
    // If currently OPEN, check if cooldown period has elapsed to move to HALF_OPEN
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastStateChangeTime;
      if (elapsed >= this.cooldownPeriodMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
    return this.state;
  }

  public isOpen(): boolean {
    return this.getState() === 'OPEN';
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new CircuitBreakerOpenError(
        `Circuit breaker is OPEN: external router calls paused for ${this.cooldownPeriodMs}ms cooldown`
      );
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (err: unknown) {
      this.recordFailure(err);
      throw err;
    }
  }

  public recordSuccess(): void {
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
  }

  public recordFailure(err?: unknown): void {
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;
    if (err instanceof Error) {
      this.lastErrorMessage = logger.sanitizeString(err.message);
    } else if (typeof err === 'string') {
      this.lastErrorMessage = logger.sanitizeString(err);
    }

    if (this.state === 'HALF_OPEN') {
      // In HALF_OPEN, any failure immediately re-trips back to OPEN
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  public reset(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastErrorMessage = null;
    this.transitionTo('CLOSED');
  }

  public trip(): void {
    this.transitionTo('OPEN');
  }

  public getDiagnostics() {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      failureThreshold: this.failureThreshold,
      cooldownPeriodMs: this.cooldownPeriodMs,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      lastSuccessTime: this.lastSuccessTime ? new Date(this.lastSuccessTime).toISOString() : null,
      lastErrorMessage: this.lastErrorMessage,
    };
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();

    if (newState === 'CLOSED') {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      metricsService.set('resilience_circuit_breaker_state', 0);
      metricsService.increment('resilience_circuit_breaker_closes_total', 1);

      logger.info('circuit_breaker_closed', {
        module: 'resilience',
        operation: 'circuit_breaker',
        fromState: oldState,
        toState: newState,
        probeResult: 'success',
      });
    } else if (newState === 'OPEN') {
      this.consecutiveSuccesses = 0;
      metricsService.set('resilience_circuit_breaker_state', 2);
      metricsService.increment('resilience_circuit_breaker_opens_total', 1);

      logger.warn('circuit_breaker_opened', {
        module: 'resilience',
        operation: 'circuit_breaker',
        fromState: oldState,
        toState: newState,
        failureCount: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
        resetTimeoutMs: this.cooldownPeriodMs,
        lastError: this.lastErrorMessage ?? undefined,
      });
    } else if (newState === 'HALF_OPEN') {
      this.consecutiveSuccesses = 0;
      metricsService.set('resilience_circuit_breaker_state', 1);
      metricsService.increment('resilience_circuit_breaker_half_open_probes_total', 1);

      logger.info('circuit_breaker_half_open', {
        module: 'resilience',
        operation: 'circuit_breaker',
        fromState: oldState,
        toState: newState,
        probe: 'starting',
        cooldownElapsedMs: this.cooldownPeriodMs,
      });
    }

    if (this.onStateChange) {
      this.onStateChange(oldState, newState);
    }
  }
}

export const circuitBreaker = new CircuitBreaker();

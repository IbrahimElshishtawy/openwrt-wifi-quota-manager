import {
  type CircuitState,
  type CircuitBreakerOptions,
  CircuitBreakerOpenError,
} from './resilience.types.js';

export { CircuitBreakerOpenError };

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastStateChangeTime: number = Date.now();
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;

  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private readonly successThreshold: number;
  private readonly onStateChange: ((from: CircuitState, to: CircuitState) => void) | undefined;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 10000;
    this.successThreshold = options.successThreshold ?? 1;
    this.onStateChange = options.onStateChange;
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
      this.recordFailure();
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

  public recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;

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
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      lastSuccessTime: this.lastSuccessTime ? new Date(this.lastSuccessTime).toISOString() : null,
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
    } else if (newState === 'OPEN') {
      this.consecutiveSuccesses = 0;
    } else if (newState === 'HALF_OPEN') {
      this.consecutiveSuccesses = 0;
    }

    if (this.onStateChange) {
      this.onStateChange(oldState, newState);
    }
  }
}

export const circuitBreaker = new CircuitBreaker();

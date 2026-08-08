import { AppError, isAppError } from './errors/app-error';
import { logger } from './logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CircuitBreakerOptions = {
  readonly name: string;
  readonly failureThreshold: number;
  readonly openMs: number;
};

/**
 * Simple per-dependency circuit breaker.
 * - CLOSED: calls flow normally; failures increment a counter
 * - OPEN: fail fast until openMs elapses
 * - HALF_OPEN: allow a probe call; success closes, failure re-opens
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getStatus(): { state: CircuitState; consecutiveFailures: number } {
    this.maybeTransitionToHalfOpen();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.beforeCall();

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private beforeCall(): void {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new AppError({
        code: 'COURIER_UNAVAILABLE',
        message: `Circuit open for ${this.options.name}. Partner calls are temporarily short-circuited.`,
        statusCode: 503,
      });
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.options.openMs) {
      this.state = 'HALF_OPEN';
      logger.warn(
        { circuit: this.options.name, state: this.state },
        'Circuit breaker half-open — allowing probe',
      );
    }
  }

  private onSuccess(): void {
    if (this.state !== 'CLOSED' || this.consecutiveFailures > 0) {
      logger.info(
        { circuit: this.options.name, previous_state: this.state },
        'Circuit breaker closed after success',
      );
    }
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  private onFailure(error: unknown): void {
    if (!this.shouldTrip(error)) {
      return;
    }

    this.consecutiveFailures += 1;

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.warn(
        {
          circuit: this.options.name,
          consecutive_failures: this.consecutiveFailures,
          open_ms: this.options.openMs,
        },
        'Circuit breaker opened',
      );
    }
  }

  /** Trip on partner outages; do not trip on validation / client / auth config errors. */
  private shouldTrip(error: unknown): boolean {
    if (isAppError(error)) {
      return error.code === 'COURIER_UNAVAILABLE';
    }
    return true;
  }
}

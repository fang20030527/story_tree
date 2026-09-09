import { AppError } from '../../core/errors';

export class ClaimAttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maximumFailures = 5,
    private readonly windowMs = 600_000,
    private readonly now: () => number = Date.now,
  ) {}

  assertAllowed(keys: readonly string[]): void {
    const timestamp = this.now();
    for (const key of keys) {
      const active = this.activeFailures(key, timestamp);
      if (active.length >= this.maximumFailures) {
        throw new AppError(
          'RATE_LIMITED',
          '尝试次数过多，请稍后再试',
          429,
          true,
        );
      }
    }
  }

  recordFailure(keys: readonly string[]): void {
    const timestamp = this.now();
    for (const key of keys) {
      const active = this.activeFailures(key, timestamp);
      active.push(timestamp);
      this.failures.set(key, active);
    }
  }

  private activeFailures(key: string, timestamp: number): number[] {
    const active = (this.failures.get(key) ?? []).filter(
      (entry) => timestamp - entry < this.windowMs,
    );
    if (active.length === 0) this.failures.delete(key);
    else this.failures.set(key, active);
    return active;
  }
}

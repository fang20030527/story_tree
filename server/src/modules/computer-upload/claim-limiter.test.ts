import { describe, expect, it } from 'vitest';

import { ClaimAttemptLimiter } from './claim-limiter';

describe('claim attempt limiter', () => {
  it('rejects the sixth failure within ten minutes per key', () => {
    const now = 1_000_000;
    const limiter = new ClaimAttemptLimiter(5, 600_000, () => now);
    const keys = ['ip:abc', 'code:def'];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => limiter.assertAllowed(keys)).not.toThrow();
      limiter.recordFailure(keys);
    }
    expect(() => limiter.assertAllowed(keys)).toThrowError(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
  });

  it('tracks IP and code-hash buckets independently', () => {
    const limiter = new ClaimAttemptLimiter(5, 600_000, () => 1_000_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.recordFailure(['ip:abc']);
    }
    expect(() => limiter.assertAllowed(['ip:abc'])).toThrowError(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
    expect(() => limiter.assertAllowed(['code:def'])).not.toThrow();
  });

  it('allows a new attempt exactly after the window elapses', () => {
    let now = 1_000_000;
    const limiter = new ClaimAttemptLimiter(5, 600_000, () => now);
    const keys = ['ip:abc', 'code:def'];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.recordFailure(keys);
    }
    now += 599_999;
    expect(() => limiter.assertAllowed(keys)).toThrowError(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
    now += 1;
    expect(() => limiter.assertAllowed(keys)).not.toThrow();
  });

  it('does not count successful claims as failures', () => {
    const limiter = new ClaimAttemptLimiter(5, 600_000, () => 1_000_000);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(() => limiter.assertAllowed(['ip:abc'])).not.toThrow();
    }
  });
});

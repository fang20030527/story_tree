import { describe, expect, it } from 'vitest';

import { retryDelayMs, shouldRetry } from './retry';

describe('job retry policy', () => {
  it('uses bounded exponential backoff with deterministic jitter', () => {
    expect(retryDelayMs(1, () => 0)).toBe(1_000);
    expect(retryDelayMs(2, () => 0)).toBe(2_000);
    expect(retryDelayMs(99, () => 1)).toBe(30_000);
  });

  it('stops at the attempt limit or resource deadline', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const future = new Date('2026-09-07T00:01:00.000Z');
    const past = new Date('2026-09-06T23:59:59.000Z');

    expect(
      shouldRetry({ attemptCount: 2, maxAttempts: 3, deadlineAt: future }, now),
    ).toBe(true);
    expect(
      shouldRetry({ attemptCount: 3, maxAttempts: 3, deadlineAt: future }, now),
    ).toBe(false);
    expect(
      shouldRetry({ attemptCount: 1, maxAttempts: 3, deadlineAt: past }, now),
    ).toBe(false);
  });
});

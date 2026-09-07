import type { ClaimedJob } from './types';

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const JITTER_RATIO = 0.25;

type RetryState = Pick<ClaimedJob, 'attemptCount' | 'maxAttempts' | 'deadlineAt'>;

export function retryDelayMs(
  attemptCount: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const base = Math.min(
    INITIAL_RETRY_DELAY_MS * 2 ** exponent,
    MAX_RETRY_DELAY_MS,
  );
  const randomValue = Math.min(1, Math.max(0, random()));
  return Math.min(
    MAX_RETRY_DELAY_MS,
    Math.round(base + base * JITTER_RATIO * randomValue),
  );
}

export function shouldRetry(state: RetryState, now = new Date()): boolean {
  return (
    state.attemptCount < state.maxAttempts && state.deadlineAt.getTime() > now.getTime()
  );
}

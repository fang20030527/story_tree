import { afterEach, describe, expect, it, vi } from 'vitest';

import { startImportCleanupRunner } from './cleanup-runner';

afterEach(() => {
  vi.useRealTimers();
});

describe('article import cleanup runner', () => {
  it('runs one non-overlapping sweep after every interval', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn(async () => undefined);
    const runner = startImportCleanupRunner({ intervalMs: 60_000, sweep });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    await runner.stop();
  });

  it('waits for an in-flight sweep and never schedules another after stop', async () => {
    vi.useFakeTimers();
    let finishSweep: (() => void) | undefined;
    const sweep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSweep = resolve;
        }),
    );
    const runner = startImportCleanupRunner({ intervalMs: 60_000, sweep });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishSweep?.();
    await stopping;
    expect(stopped).toBe(true);

    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('continues after a failed sweep until it is stopped', async () => {
    vi.useFakeTimers();
    const sweep = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('synthetic cleanup failure'))
      .mockResolvedValue(undefined);
    const runner = startImportCleanupRunner({ intervalMs: 60_000, sweep });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    await runner.stop();
  });
});

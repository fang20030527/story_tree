export interface ImportCleanupRunner {
  stop(): Promise<void>;
}

export function startImportCleanupRunner(options: {
  intervalMs?: number;
  sweep: () => Promise<unknown>;
}): ImportCleanupRunner {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be a positive integer');
  }

  const controller = new AbortController();
  const done = run({ intervalMs, sweep: options.sweep }, controller.signal);
  return {
    async stop() {
      controller.abort();
      await done;
    },
  };
}

async function run(
  options: { intervalMs: number; sweep: () => Promise<unknown> },
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await abortableDelay(options.intervalMs, signal);
    if (signal.aborted) return;
    try {
      await options.sweep();
    } catch {
      if (signal.aborted) return;
    }
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref();
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

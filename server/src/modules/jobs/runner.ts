import { AppError } from '../../core/errors';
import {
  claimExpiredJob,
  claimNextJob,
  markSucceeded,
  renewLease,
  rescheduleOrFail,
} from './repository';
import { shouldRetry } from './retry';
import type {
  ClaimedJob,
  JobKind,
  JobRegistration,
  RunnerOptions,
} from './types';

export function assertJobRegistrations(
  enabledKinds: readonly JobKind[],
  registrations: Partial<Record<JobKind, JobRegistration>>,
): void {
  for (const kind of enabledKinds) {
    const registration = registrations[kind];
    if (
      !registration ||
      typeof registration.handle !== 'function' ||
      typeof registration.onPermanentFailure !== 'function'
    ) {
      throw new Error(`Missing complete job registration for ${kind}`);
    }
  }
}

export function startJobRunner(options: RunnerOptions): { stop(): Promise<void> } {
  assertJobRegistrations(options.enabledKinds, options.registrations);
  const controller = new AbortController();
  const done = runLoop(options, controller.signal);
  let stopPromise: Promise<void> | undefined;

  return {
    stop: () => {
      controller.abort();
      stopPromise ??= done;
      return stopPromise;
    },
  };
}

async function runLoop(options: RunnerOptions, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const expired = await claimExpiredJob(
        options.db,
        options.workerId,
        options.leaseMs,
        options.enabledKinds,
      );
      const job =
        expired ??
        (await claimNextJob(
          options.db,
          options.workerId,
          options.leaseMs,
          options.enabledKinds,
        ));

      if (!job) {
        await abortableDelay(options.pollIntervalMs, signal);
        continue;
      }

      await processJob(options, job, signal);
    } catch {
      if (!signal.aborted) {
        await abortableDelay(options.pollIntervalMs, signal);
      }
    }
  }
}

async function processJob(
  options: RunnerOptions,
  job: ClaimedJob,
  runnerSignal: AbortSignal,
): Promise<void> {
  const jobController = new AbortController();
  const heartbeatController = new AbortController();
  const abortJob = () => {
    jobController.abort(runnerSignal.reason);
    heartbeatController.abort(runnerSignal.reason);
  };
  runnerSignal.addEventListener('abort', abortJob, { once: true });
  if (runnerSignal.aborted) abortJob();
  const heartbeat = runHeartbeat(
    options,
    job,
    jobController,
    heartbeatController.signal,
  );

  try {
    const registration = options.registrations[job.kind];
    if (!registration) {
      await rescheduleOrFail(
        options.db,
        job,
        new AppError('INTERNAL_ERROR', '任务处理器未注册', 500),
      );
      return;
    }

    if (job.expired || job.attemptCount > job.maxAttempts) {
      const error = job.expired
        ? new AppError(
            'GENERATION_DEADLINE_EXCEEDED',
            '任务已超过截止时间',
            504,
          )
        : new AppError('AI_UNAVAILABLE', '任务重试次数已用完', 503);
      await finalizePermanentFailure(options, registration, job, error, jobController.signal);
      return;
    }

    try {
      await registration.handle(job, { signal: jobController.signal });
    } catch (error) {
      if (jobController.signal.aborted) return;
      await handleJobError(
        options,
        registration,
        job,
        toAppError(error),
        jobController.signal,
      );
      return;
    }

    if (!jobController.signal.aborted) {
      await markSucceeded(options.db, job.id, job.lockedBy);
    }
  } finally {
    runnerSignal.removeEventListener('abort', abortJob);
    heartbeatController.abort();
    await heartbeat;
  }
}

async function handleJobError(
  options: RunnerOptions,
  registration: JobRegistration,
  job: ClaimedJob,
  error: AppError,
  signal: AbortSignal,
): Promise<void> {
  const now = new Date();
  if (!error.retryable || !shouldRetry(job, now)) {
    await registration.onPermanentFailure(job, error, { signal });
  }
  if (!signal.aborted) {
    await rescheduleOrFail(options.db, job, error, { now });
  }
}

async function finalizePermanentFailure(
  options: RunnerOptions,
  registration: JobRegistration,
  job: ClaimedJob,
  error: AppError,
  signal: AbortSignal,
): Promise<void> {
  await registration.onPermanentFailure(job, error, { signal });
  if (!signal.aborted) {
    await rescheduleOrFail(options.db, job, error);
  }
}

async function runHeartbeat(
  options: RunnerOptions,
  job: ClaimedJob,
  jobController: AbortController,
  signal: AbortSignal,
): Promise<void> {
  const intervalMs = Math.max(1, Math.floor(options.leaseMs / 3));

  while (!signal.aborted) {
    await abortableDelay(intervalMs, signal);
    if (signal.aborted) return;

    try {
      const renewed = await renewLease(
        options.db,
        job.id,
        job.lockedBy,
        options.leaseMs,
      );
      if (!renewed) {
        jobController.abort(new Error('Job lease lost'));
        return;
      }
    } catch (error) {
      jobController.abort(error);
      return;
    }
  }
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL_ERROR', '任务处理失败', 500, true);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

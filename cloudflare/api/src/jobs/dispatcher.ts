import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { deleteExpiredRateLimits } from '../core/rate-limit';
import { isApiConfigured, type ApiEnv } from '../env';
import {
  sweepExpiredImportAssets,
  sweepOrphanedImportObjects,
} from '../imports/storage';
import {
  claimJobById,
  markSucceeded,
  renewLease,
  rescheduleOrFail,
  shouldRetry,
  type ClaimedJob,
  type JobKind,
} from './repository';
import {
  failArticleTranslation,
  failTranslation,
  handleArticleTranslation,
  handleTranslation,
} from './translation';
import {
  failPracticeGeneration,
  handlePracticeGeneration,
} from './practice-generation';
import { failArticleImport, handleArticleImport } from './import-handler';

const STAGING_KINDS = ['translation', 'article_translation'] as const satisfies readonly JobKind[];
const PRODUCTION_KINDS = [
  'practice_generation', 'translation', 'article_import', 'article_translation',
] as const satisfies readonly JobKind[];
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const ASSET_TTL_MS = 86_400_000;
const CRON_JOB_BATCH = 20;
const ORPHAN_PAGE_SIZE = 100;
const MAX_ORPHAN_PAGES = 20;

interface QueueMessage {
  readonly body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface JobQueueBatch {
  readonly messages: readonly QueueMessage[];
}

interface JobProbe {
  kind: JobKind;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  availableAt: string;
  leaseExpiresAt: string | null;
}

interface JobIdRow {
  id: string;
}

type Delivery = { disposition: 'ack' } | { disposition: 'retry'; delaySeconds: number };

function enabledKinds(env: ApiEnv): readonly JobKind[] {
  return isApiConfigured(env) ? PRODUCTION_KINDS : STAGING_KINDS;
}

function isEnabledKind(env: ApiEnv, kind: string): kind is JobKind {
  return enabledKinds(env).includes(kind as JobKind);
}

function queueJobId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const jobId = (body as { jobId?: unknown }).jobId;
  return UuidSchema.safeParse(jobId).success ? jobId as string : null;
}

function delaySeconds(until: string | null, fallback = 5): number {
  if (!until) return fallback;
  const timestamp = Date.parse(until);
  if (!Number.isFinite(timestamp)) return fallback;
  return Math.min(3_600, Math.max(1, Math.ceil((timestamp - Date.now()) / 1_000) + 1));
}

async function dispositionWithoutClaim(env: ApiEnv, jobId: string): Promise<Delivery> {
  const job = await env.DB.prepare(`
    SELECT kind, status, available_at AS availableAt,
           lease_expires_at AS leaseExpiresAt
    FROM jobs WHERE id = ? LIMIT 1
  `).bind(jobId).first<JobProbe>();
  if (!job || job.status === 'succeeded' || job.status === 'failed') {
    return { disposition: 'ack' };
  }
  // An unimplemented kind is never claimed and cannot be acknowledged as done.
  if (!isEnabledKind(env, job.kind)) return { disposition: 'retry', delaySeconds: 300 };
  if (job.status === 'running') {
    return { disposition: 'retry', delaySeconds: delaySeconds(job.leaseExpiresAt, 30) };
  }
  return { disposition: 'retry', delaySeconds: delaySeconds(job.availableAt, 2) };
}

function toAppError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError('INTERNAL_ERROR', '任务处理失败', 500, true);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

async function maintainLease(
  env: ApiEnv,
  job: ClaimedJob,
  controller: AbortController,
  stop: AbortSignal,
): Promise<void> {
  // Expired jobs are only finalized. Their deadline is already past, so the
  // repository intentionally refuses to renew their temporary claim.
  if (job.expired) return;
  while (!stop.aborted && !controller.signal.aborted) {
    await abortableDelay(HEARTBEAT_MS, stop);
    if (stop.aborted || controller.signal.aborted) return;
    try {
      const renewed = await renewLease(env.DB, job.id, job.lockedBy, LEASE_MS);
      if (!renewed) {
        controller.abort(new Error('Job lease lost'));
        return;
      }
    } catch {
      controller.abort(new Error('Job lease renewal failed'));
      return;
    }
  }
}

function handlerFor(kind: JobKind) {
  switch (kind) {
    case 'practice_generation':
      return { handle: handlePracticeGeneration, fail: failPracticeGeneration };
    case 'translation':
      return { handle: handleTranslation, fail: failTranslation };
    case 'article_translation':
      return { handle: handleArticleTranslation, fail: failArticleTranslation };
    case 'article_import':
      return { handle: handleArticleImport, fail: failArticleImport };
  }
}

async function finalizeResourceFailure(
  fail: typeof failTranslation,
  env: ApiEnv,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  try {
    await fail(env, job, error, context);
  } catch (cause) {
    // A deleted translation has no resource row to mark failed, but its D1
    // job still needs a terminal disposition. Lease loss and other failures
    // remain retryable through the queue and Cron recovery path.
    if (!(cause instanceof AppError && cause.code === 'NOT_FOUND')) throw cause;
  }
}

async function retryAfterReschedule(env: ApiEnv, jobId: string): Promise<Delivery> {
  const row = await env.DB.prepare(`
    SELECT available_at AS availableAt FROM jobs
    WHERE id = ? AND status = 'queued' LIMIT 1
  `).bind(jobId).first<{ availableAt: string }>();
  return { disposition: 'retry', delaySeconds: delaySeconds(row?.availableAt ?? null, 2) };
}

async function processClaimedJob(env: ApiEnv, job: ClaimedJob): Promise<Delivery> {
  if (!isEnabledKind(env, job.kind)) {
    // The repository already filters these out; retain this boundary if its
    // enabled-kind behavior changes in the future.
    return { disposition: 'retry', delaySeconds: 300 };
  }

  const registration = handlerFor(job.kind);
  const controller = new AbortController();
  const heartbeatStop = new AbortController();
  const heartbeat = maintainLease(env, job, controller, heartbeatStop.signal);
  const deadlineTimer = job.expired ? undefined : setTimeout(
    () => controller.abort(new Error('Job deadline reached')),
    Math.min(2_147_483_647, Math.max(1, job.deadlineAt.getTime() - Date.now())),
  );
  const context = { signal: controller.signal };

  try {
    if (job.expired || job.attemptCount > job.maxAttempts) {
      const now = new Date();
      const error = job.expired
        ? new AppError('GENERATION_DEADLINE_EXCEEDED', '任务已超过截止时间', 504)
        : new AppError('AI_UNAVAILABLE', '任务重试次数已用完', 503);
      await finalizeResourceFailure(registration.fail, env, job, error, context);
      if (controller.signal.aborted) return { disposition: 'retry', delaySeconds: 5 };
      const state = await rescheduleOrFail(env.DB, job, error, { now });
      if (state === 'rescheduled') return retryAfterReschedule(env, job.id);
      return state === 'lease_lost'
        ? { disposition: 'retry', delaySeconds: 5 }
        : { disposition: 'ack' };
    }

    try {
      await registration.handle(env, job, context);
    } catch (cause) {
      if (controller.signal.aborted) return { disposition: 'retry', delaySeconds: 5 };
      const error = toAppError(cause);
      const now = new Date();
      if (!error.retryable || !shouldRetry(job, now)) {
        await finalizeResourceFailure(registration.fail, env, job, error, context);
      }
      if (controller.signal.aborted) return { disposition: 'retry', delaySeconds: 5 };
      const state = await rescheduleOrFail(env.DB, job, error, { now });
      if (state === 'rescheduled') return retryAfterReschedule(env, job.id);
      return state === 'lease_lost'
        ? { disposition: 'retry', delaySeconds: 5 }
        : { disposition: 'ack' };
    }

    if (controller.signal.aborted) return { disposition: 'retry', delaySeconds: 5 };
    const succeeded = await markSucceeded(env.DB, job.id, job.lockedBy);
    return succeeded
      ? { disposition: 'ack' }
      : { disposition: 'retry', delaySeconds: 5 };
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    heartbeatStop.abort();
    await heartbeat;
  }
}

async function deliverMessage(env: ApiEnv, message: QueueMessage): Promise<Delivery> {
  const jobId = queueJobId(message.body);
  if (!jobId) return { disposition: 'retry', delaySeconds: 300 };
  const claimed = await claimJobById(env.DB, jobId, crypto.randomUUID(), LEASE_MS, enabledKinds(env));
  return claimed ? processClaimedJob(env, claimed) : dispositionWithoutClaim(env, jobId);
}

/** Queue messages are hints; D1 remains the source of truth for every job. */
export async function handleJobQueue(batch: JobQueueBatch, env: ApiEnv): Promise<void> {
  for (const message of batch.messages) {
    let outcome: Delivery;
    try {
      outcome = await deliverMessage(env, message);
    } catch {
      // Keep the D1 lease and resource state for recovery. A later delivery
      // or Cron pass can reclaim it after the lease expires.
      outcome = { disposition: 'retry', delaySeconds: 30 };
    }
    if (outcome.disposition === 'ack') message.ack();
    else message.retry({ delaySeconds: outcome.delaySeconds });
  }
}

async function enqueueDueJobs(env: ApiEnv, now: Date): Promise<void> {
  const kinds = enabledKinds(env);
  const kindPlaceholders = kinds.map((_, index) => `?${index + 2}`).join(', ');
  const limitPlaceholder = `?${kinds.length + 2}`;
  const due = await env.DB.prepare(`
    SELECT id FROM jobs
    WHERE kind IN (${kindPlaceholders})
      AND available_at <= ?1
      AND (status = 'queued' OR
        (status = 'running' AND lease_expires_at < ?1))
    ORDER BY available_at, created_at, id
    LIMIT ${limitPlaceholder}
  `).bind(now.toISOString(), ...kinds, CRON_JOB_BATCH).all<JobIdRow>();
  if (due.results.length === 0) return;
  if (!env.JOB_QUEUE) {
    throw new AppError('INTERNAL_ERROR', '任务队列尚未配置', 503, true);
  }
  for (const { id } of due.results) {
    await env.JOB_QUEUE.send({ jobId: id });
  }
}

async function sweepImportStorage(env: ApiEnv, now: Date): Promise<void> {
  const expired = await sweepExpiredImportAssets(env, {
    now,
    assetTtlMs: ASSET_TTL_MS,
    batchSize: 100,
  });
  if (expired.failed > 0) {
    throw new AppError('INTERNAL_ERROR', '过期导入文件清理未完成', 503, true);
  }

  let cursor: string | null = null;
  for (let page = 0; page < MAX_ORPHAN_PAGES; page += 1) {
    const result = await sweepOrphanedImportObjects(env, {
      now,
      ...(cursor ? { cursor } : {}),
      batchSize: ORPHAN_PAGE_SIZE,
    });
    cursor = result.nextCursor;
    if (!cursor) return;
  }
  // Never report a complete cleanup when this bounded Cron pass missed pages.
  throw new AppError('INTERNAL_ERROR', '孤儿导入文件清理未完成', 503, true);
}

/** One bounded Cron pass dispatches recoverable jobs and maintains temporary data. */
export async function handleJobScheduled(env: ApiEnv): Promise<void> {
  const now = new Date();
  const outcomes = await Promise.allSettled([
    enqueueDueJobs(env, now),
    deleteExpiredRateLimits(env, now),
    sweepImportStorage(env, now),
  ]);
  if (outcomes.some((result) => result.status === 'rejected')) {
    throw new AppError('INTERNAL_ERROR', '定时维护未完成', 503, true);
  }
}

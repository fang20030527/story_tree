import type { D1DatabaseBinding } from '../env';

export const jobKinds = [
  'practice_generation',
  'translation',
  'article_import',
  'article_translation',
] as const;

export type JobKind = (typeof jobKinds)[number];

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  resourceId: string;
  attemptCount: number;
  maxAttempts: number;
  deadlineAt: Date;
  lockedBy: string;
  expired: boolean;
}

export interface JobFailure {
  code: string;
  retryable: boolean;
}

export type JobDisposition = 'rescheduled' | 'failed' | 'lease_lost';

interface ClaimedJobRow {
  id: string;
  kind: JobKind;
  resource_id: string;
  attempt_count: number;
  max_attempts: number;
  deadline_at: string;
  locked_by: string;
  expired: number;
}

type ClaimScope = 'active' | 'expired' | 'any';

const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// ?1 is leaseMs. SQLite's date modifier accepts fractional seconds.
const DB_LEASE_UNTIL =
  "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', printf('+%.3f seconds', ?1 / 1000.0))";

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const JITTER_RATIO = 0.25;

/** Claim one due, not-yet-expired job for a scheduled fallback drain. */
export function claimNextJob(
  db: D1DatabaseBinding,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
): Promise<ClaimedJob | null> {
  return claimJob(db, workerId, leaseMs, enabledKinds, 'active');
}

/** Claim one due job after its deadline so its failure handler can finalize it. */
export function claimExpiredJob(
  db: D1DatabaseBinding,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
): Promise<ClaimedJob | null> {
  return claimJob(db, workerId, leaseMs, enabledKinds, 'expired');
}

/** Claim only the job named by a Queue message. Duplicate messages return null. */
export function claimJobById(
  db: D1DatabaseBinding,
  jobId: string,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
): Promise<ClaimedJob | null> {
  if (!jobId) return Promise.resolve(null);
  return claimJob(db, workerId, leaseMs, enabledKinds, 'any', jobId);
}

export async function renewLease(
  db: D1DatabaseBinding,
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  assertLeaseMs(leaseMs);
  const row = await db.prepare(`
    UPDATE jobs
    SET lease_expires_at = min(deadline_at, ${DB_LEASE_UNTIL})
    WHERE id = ?2 AND locked_by = ?3 AND status = 'running'
      AND lease_expires_at > ${DB_NOW}
      AND deadline_at > ${DB_NOW}
    RETURNING id
  `).bind(leaseMs, jobId, workerId).first<{ id: string }>();
  return row !== null;
}

export async function markSucceeded(
  db: D1DatabaseBinding,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const row = await db.prepare(`
    UPDATE jobs
    SET status = 'succeeded', locked_at = NULL, lease_expires_at = NULL,
      locked_by = NULL, last_error_code = NULL, finished_at = ${DB_NOW}
    WHERE id = ?1 AND locked_by = ?2 AND status = 'running'
      AND lease_expires_at > ${DB_NOW}
    RETURNING id
  `).bind(jobId, workerId).first<{ id: string }>();
  return row !== null;
}

export async function rescheduleOrFail(
  db: D1DatabaseBinding,
  job: ClaimedJob,
  error: JobFailure,
  options: { now?: Date; random?: () => number } = {},
): Promise<JobDisposition> {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const retry = error.retryable && shouldRetry(job, now);
  const availableAt = new Date(
    Math.min(job.deadlineAt.getTime(), now.getTime() + retryDelayMs(job.attemptCount, random)),
  );

  const sql = retry
    ? `UPDATE jobs
       SET status = 'queued', available_at = ?1, locked_at = NULL,
         lease_expires_at = NULL, locked_by = NULL, last_error_code = ?2,
         finished_at = NULL
       WHERE id = ?3 AND locked_by = ?4 AND status = 'running'
         AND lease_expires_at > ${DB_NOW}
       RETURNING id`
    : `UPDATE jobs
       SET status = 'failed', locked_at = NULL, lease_expires_at = NULL,
         locked_by = NULL, last_error_code = ?2, finished_at = ?1
       WHERE id = ?3 AND locked_by = ?4 AND status = 'running'
         AND lease_expires_at > ${DB_NOW}
       RETURNING id`;
  const row = await db.prepare(sql).bind(
    retry ? availableAt.toISOString() : now.toISOString(),
    error.code,
    job.id,
    job.lockedBy,
  ).first<{ id: string }>();

  if (row === null) return 'lease_lost';
  return retry ? 'rescheduled' : 'failed';
}

export function retryDelayMs(
  attemptCount: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const base = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
  const randomValue = Math.min(1, Math.max(0, random()));
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base + base * JITTER_RATIO * randomValue));
}

export function shouldRetry(
  state: Pick<ClaimedJob, 'attemptCount' | 'maxAttempts' | 'deadlineAt'>,
  now = new Date(),
): boolean {
  return state.attemptCount < state.maxAttempts && state.deadlineAt.getTime() > now.getTime();
}

async function claimJob(
  db: D1DatabaseBinding,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
  scope: ClaimScope,
  jobId?: string,
): Promise<ClaimedJob | null> {
  assertLeaseMs(leaseMs);
  if (!workerId || enabledKinds.length === 0) return null;

  // Placeholders bind every kind and optional id; no caller value is interpolated
  // into SQL. The UPDATE and candidate selection are one atomic D1 statement.
  const kindPlaceholders = enabledKinds.map((_, i) => `?${i + 3}`).join(', ');
  const deadlinePredicate = scope === 'active'
    ? `AND deadline_at > ${DB_NOW}`
    : scope === 'expired'
      ? `AND deadline_at <= ${DB_NOW}`
      : '';
  const idPredicate = jobId === undefined ? '' : `AND id = ?${enabledKinds.length + 3}`;
  const sql = `
    UPDATE jobs
    SET status = 'running', attempt_count = attempt_count + 1,
      locked_at = ${DB_NOW},
      lease_expires_at = CASE
        WHEN deadline_at <= ${DB_NOW} THEN ${DB_LEASE_UNTIL}
        ELSE min(deadline_at, ${DB_LEASE_UNTIL})
      END,
      locked_by = ?2
    WHERE id = (
      SELECT id FROM jobs
      WHERE available_at <= ${DB_NOW}
        AND kind IN (${kindPlaceholders})
        AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ${DB_NOW}))
        ${deadlinePredicate}
        ${idPredicate}
      ORDER BY available_at ASC, created_at ASC, id ASC
      LIMIT 1
    )
    RETURNING id, kind, resource_id, attempt_count, max_attempts,
      deadline_at, locked_by, (deadline_at <= ${DB_NOW}) AS expired
  `;
  const bindings: unknown[] = [leaseMs, workerId, ...enabledKinds];
  if (jobId !== undefined) bindings.push(jobId);
  const row = await db.prepare(sql).bind(...bindings).first<ClaimedJobRow>();
  if (row === null) return null;
  return parseClaimedJob(row);
}

function parseClaimedJob(row: ClaimedJobRow): ClaimedJob {
  const deadlineAt = new Date(row.deadline_at);
  if (
    !jobKinds.includes(row.kind) ||
    !Number.isInteger(row.attempt_count) || row.attempt_count < 0 ||
    !Number.isInteger(row.max_attempts) || row.max_attempts <= 0 ||
    !Number.isFinite(deadlineAt.getTime()) ||
    !row.id || !row.resource_id || !row.locked_by ||
    (row.expired !== 0 && row.expired !== 1)
  ) {
    throw new Error('Invalid claimed job row');
  }
  return {
    id: row.id,
    kind: row.kind,
    resourceId: row.resource_id,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    deadlineAt,
    lockedBy: row.locked_by,
    expired: row.expired === 1,
  };
}

function assertLeaseMs(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new RangeError('leaseMs must be a positive safe integer');
  }
}

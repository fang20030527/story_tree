import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { jobs } from '../../db/schema';
import { retryDelayMs, shouldRetry } from './retry';
import { jobKinds, type ClaimedJob, type JobKind } from './types';

const ClaimedJobRowSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(jobKinds),
    resource_id: z.uuid(),
    attempt_count: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    deadline_at: z.coerce.date(),
    locked_by: z.string().min(1),
  })
  .strict();

type ClaimedJobRow = z.infer<typeof ClaimedJobRowSchema>;

export type JobDisposition = 'rescheduled' | 'failed' | 'lease_lost';

export async function claimNextJob(
  db: AppDatabase,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
): Promise<ClaimedJob | null> {
  return claimJob(db, workerId, leaseMs, enabledKinds, false);
}

export async function claimExpiredJob(
  db: AppDatabase,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
): Promise<ClaimedJob | null> {
  return claimJob(db, workerId, leaseMs, enabledKinds, true);
}

export async function renewLease(
  db: AppDatabase,
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  assertLeaseMs(leaseMs);
  const [renewed] = await db
    .update(jobs)
    .set({
      leaseExpiresAt: sql`least(
        now() + (${leaseMs} * interval '1 millisecond'),
        ${jobs.deadlineAt}
      )`,
    })
    .where(and(activeLease(jobId, workerId), sql`${jobs.deadlineAt} > now()`))
    .returning({ id: jobs.id });
  return renewed !== undefined;
}

export async function markSucceeded(
  db: AppDatabase,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(jobs)
    .set({
      status: 'succeeded',
      lockedAt: null,
      leaseExpiresAt: null,
      lockedBy: null,
      lastErrorCode: null,
      finishedAt: new Date(),
    })
    .where(activeLease(jobId, workerId))
    .returning({ id: jobs.id });
  return updated !== undefined;
}

export async function rescheduleOrFail(
  db: AppDatabase,
  job: ClaimedJob,
  error: AppError,
  options: { now?: Date; random?: () => number } = {},
): Promise<JobDisposition> {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const retry = error.retryable && shouldRetry(job, now);
  const availableAt = new Date(
    Math.min(job.deadlineAt.getTime(), now.getTime() + retryDelayMs(job.attemptCount, random)),
  );

  const [updated] = await db
    .update(jobs)
    .set(
      retry
        ? {
            status: 'queued',
            availableAt,
            lockedAt: null,
            leaseExpiresAt: null,
            lockedBy: null,
            lastErrorCode: error.code,
            finishedAt: null,
          }
        : {
            status: 'failed',
            lockedAt: null,
            leaseExpiresAt: null,
            lockedBy: null,
            lastErrorCode: error.code,
            finishedAt: now,
          },
    )
    .where(activeLease(job.id, job.lockedBy))
    .returning({ id: jobs.id });

  if (!updated) return 'lease_lost';
  return retry ? 'rescheduled' : 'failed';
}

async function claimJob(
  db: AppDatabase,
  workerId: string,
  leaseMs: number,
  enabledKinds: readonly JobKind[],
  expired: boolean,
): Promise<ClaimedJob | null> {
  assertLeaseMs(leaseMs);
  if (workerId.length === 0 || enabledKinds.length === 0) return null;

  const kindParameters = sql.join(
    enabledKinds.map((kind) => sql`${kind}`),
    sql`, `,
  );
  const deadlineCondition = expired
    ? sql`"deadline_at" <= now()`
    : sql`"deadline_at" > now()`;
  const leaseExpiration = expired
    ? sql`now() + (${leaseMs} * interval '1 millisecond')`
    : sql`least(
        now() + (${leaseMs} * interval '1 millisecond'),
        "deadline_at"
      )`;
  const result = await db.execute<ClaimedJobRow>(sql`
    with candidate as (
      select "id"
      from ${jobs}
      where "available_at" <= now()
        and ${deadlineCondition}
        and "kind" in (${kindParameters})
        and (
          "status" = 'queued'
          or ("status" = 'running' and "lease_expires_at" < now())
        )
      order by "available_at" asc, "created_at" asc
      for update skip locked
      limit 1
    )
    update ${jobs}
    set "status" = 'running',
        "attempt_count" = "attempt_count" + 1,
        "locked_at" = now(),
        "lease_expires_at" = ${leaseExpiration},
        "locked_by" = ${workerId}
    where "id" in (select "id" from candidate)
    returning "id", "kind", "resource_id", "attempt_count", "max_attempts",
      "deadline_at", "locked_by"
  `);
  const row = result.rows[0];
  if (!row) return null;

  const parsed = ClaimedJobRowSchema.parse(row);
  return {
    id: parsed.id,
    kind: parsed.kind,
    resourceId: parsed.resource_id,
    attemptCount: parsed.attempt_count,
    maxAttempts: parsed.max_attempts,
    deadlineAt: parsed.deadline_at,
    lockedBy: parsed.locked_by,
    expired,
  };
}

function activeLease(jobId: string, workerId: string) {
  return and(
    eq(jobs.id, jobId),
    eq(jobs.lockedBy, workerId),
    eq(jobs.status, 'running'),
    sql`${jobs.leaseExpiresAt} > now()`,
  );
}

function assertLeaseMs(leaseMs: number): void {
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw new RangeError('leaseMs must be a positive integer');
  }
}

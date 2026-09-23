import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { AppError } from '../../core/errors';
import { jobs, practiceSessions, users } from '../../db/schema';
import {
  claimExpiredJob,
  claimNextJob,
  markSucceeded,
  renewLease,
  rescheduleOrFail,
} from './repository';
import { startJobRunner } from './runner';

describe('database job leases', () => {
  it('runs four practice jobs concurrently so one article does not consume the others\' deadlines', async () => {
    await withTestDatabase(async ({ db }) => {
      const userId = crypto.randomUUID();
      await db.insert(users).values({ id: userId, kind: 'guest', ageConfirmedAt: new Date() });
      const practiceIds = Array.from({ length: 4 }, () => crypto.randomUUID());
      await db.insert(practiceSessions).values(practiceIds.map((id) => ({ id, userId, status: 'queued' as const })));
      await db.insert(jobs).values(practiceIds.map((resourceId) => ({
        id: crypto.randomUUID(), kind: 'practice_generation' as const, resourceId,
        deadlineAt: new Date(Date.now() + 120_000),
      })));
      let active = 0;
      let peak = 0;
      let release: () => void = () => undefined;
      let notifyAllStarted: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const allStarted = new Promise<void>((resolve) => { notifyAllStarted = resolve; });
      const runner = startJobRunner({
        db, workerId: 'parallel-practice-worker', concurrency: 4,
        leaseMs: 30_000, pollIntervalMs: 10, enabledKinds: ['practice_generation'],
        registrations: { practice_generation: {
          handle: async () => {
            active += 1;
            peak = Math.max(peak, active);
            if (active === 4) notifyAllStarted();
            await gate;
            active -= 1;
          },
          onPermanentFailure: async () => undefined,
        } },
      });
      try {
        await Promise.race([
          allStarted,
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Four jobs did not start')), 5_000)),
        ]);
        expect(peak).toBe(4);
      } finally {
        release();
        await runner.stop();
      }
    });
  }, 120_000);

  it('claims atomically, recovers leases, and finalizes expired work once', async () => {
    await withTestDatabase(async ({ db }) => {
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        kind: 'guest',
        ageConfirmedAt: new Date(),
      });
      const practiceId = crypto.randomUUID();
      await db.insert(practiceSessions).values({
        id: practiceId,
        userId,
        examPath: 'ielts',
        status: 'queued',
      });
      const jobId = crypto.randomUUID();
      await db.insert(jobs).values({
        id: jobId,
        kind: 'practice_generation',
        resourceId: practiceId,
        deadlineAt: new Date(Date.now() + 120_000),
      });

      const claims = await Promise.all([
        claimNextJob(db, 'worker-a', 30_000, ['practice_generation']),
        claimNextJob(db, 'worker-b', 30_000, ['practice_generation']),
      ]);
      const winner = claims.find((claim) => claim !== null);
      expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
      expect(winner).toMatchObject({ id: jobId, attemptCount: 1, expired: false });

      await db
        .update(jobs)
        .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(jobs.id, jobId));
      const reclaimed = await claimNextJob(
        db,
        'worker-c',
        30_000,
        ['practice_generation'],
      );
      expect(reclaimed).toMatchObject({
        id: jobId,
        attemptCount: 2,
        lockedBy: 'worker-c',
        expired: false,
      });
      expect(await renewLease(db, jobId, winner!.lockedBy, 30_000)).toBe(false);
      expect(await renewLease(db, jobId, 'worker-c', 30_000)).toBe(true);
      expect(await markSucceeded(db, jobId, winner!.lockedBy)).toBe(false);
      expect(await markSucceeded(db, jobId, 'worker-c')).toBe(true);

      const retryPracticeId = crypto.randomUUID();
      await db.insert(practiceSessions).values({
        id: retryPracticeId,
        userId,
        examPath: 'ielts',
        status: 'queued',
      });
      const retryDeadline = new Date(Date.now() + 30_000);
      const retryJobId = crypto.randomUUID();
      await db.insert(jobs).values({
        id: retryJobId,
        kind: 'practice_generation',
        resourceId: retryPracticeId,
        deadlineAt: retryDeadline,
      });
      const retryJob = await claimNextJob(
        db,
        'retry-worker',
        30_000,
        ['practice_generation'],
      );
      expect(retryJob).toMatchObject({ id: retryJobId, attemptCount: 1 });
      const [boundedLease] = await db
        .select({ leaseExpiresAt: jobs.leaseExpiresAt })
        .from(jobs)
        .where(eq(jobs.id, retryJobId));
      expect(boundedLease?.leaseExpiresAt).toEqual(retryDeadline);
      expect(
        await rescheduleOrFail(
          db,
          retryJob!,
          new AppError('AI_UNAVAILABLE', 'AI 服务暂时不可用', 503, true),
          {
            now: new Date(retryDeadline.getTime() - 500),
            random: () => 0,
          },
        ),
      ).toBe('rescheduled');
      const [rescheduled] = await db
        .select({ status: jobs.status, availableAt: jobs.availableAt })
        .from(jobs)
        .where(eq(jobs.id, retryJobId));
      expect(rescheduled).toEqual({ status: 'queued', availableAt: retryDeadline });
      await db
        .update(jobs)
        .set({ status: 'failed', finishedAt: new Date() })
        .where(eq(jobs.id, retryJobId));

      const expiredPracticeId = crypto.randomUUID();
      await db.insert(practiceSessions).values({
        id: expiredPracticeId,
        userId,
        examPath: 'ielts',
        status: 'queued',
      });
      const expiredJobId = crypto.randomUUID();
      await db.insert(jobs).values({
        id: expiredJobId,
        kind: 'practice_generation',
        resourceId: expiredPracticeId,
        deadlineAt: new Date(Date.now() - 1_000),
      });

      const expiredClaims = await Promise.all([
        claimExpiredJob(db, 'expiry-a', 30_000, ['practice_generation']),
        claimExpiredJob(db, 'expiry-b', 30_000, ['practice_generation']),
      ]);
      const expiredWinner = expiredClaims.find((claim) => claim !== null);
      expect(expiredClaims.filter((claim) => claim !== null)).toHaveLength(1);
      expect(expiredWinner).toMatchObject({ id: expiredJobId, expired: true });

      const disposition = await rescheduleOrFail(
        db,
        expiredWinner!,
        new AppError(
          'GENERATION_DEADLINE_EXCEEDED',
          '生成任务已超过截止时间',
          504,
        ),
        { now: new Date(), random: () => 0 },
      );
      expect(disposition).toBe('failed');
      expect(
        await claimExpiredJob(db, 'expiry-c', 30_000, ['practice_generation']),
      ).toBeNull();

      const exhaustedPracticeId = crypto.randomUUID();
      await db.insert(practiceSessions).values({
        id: exhaustedPracticeId,
        userId,
        examPath: 'ielts',
        status: 'queued',
      });
      const exhaustedJobId = crypto.randomUUID();
      await db.insert(jobs).values({
        id: exhaustedJobId,
        kind: 'practice_generation',
        resourceId: exhaustedPracticeId,
        maxAttempts: 1,
        availableAt: new Date(Date.now() - 5_000),
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const exhaustedFirstAttempt = await claimNextJob(
        db,
        'crashed-worker',
        30_000,
        ['practice_generation'],
      );
      expect(exhaustedFirstAttempt).toMatchObject({
        id: exhaustedJobId,
        attemptCount: 1,
      });
      await db
        .update(jobs)
        .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(jobs.id, exhaustedJobId));

      const runnerPracticeId = crypto.randomUUID();
      await db.insert(practiceSessions).values({
        id: runnerPracticeId,
        userId,
        examPath: 'ielts',
        status: 'queued',
      });
      const runnerJobId = crypto.randomUUID();
      await db.insert(jobs).values({
        id: runnerJobId,
        kind: 'practice_generation',
        resourceId: runnerPracticeId,
        deadlineAt: new Date(Date.now() + 120_000),
      });

      let signalWasAborted = false;
      const handledJobIds: string[] = [];
      const permanentFailureCodes: string[] = [];
      let notifyStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const runner = startJobRunner({
        db,
        workerId: 'lifecycle-worker',
        leaseMs: 30_000,
        pollIntervalMs: 10,
        enabledKinds: ['practice_generation'],
        registrations: {
          practice_generation: {
            handle: async (job, { signal }) => {
              handledJobIds.push(job.id);
              notifyStarted();
              await new Promise<void>((resolve) => {
                if (signal.aborted) {
                  resolve();
                  return;
                }
                signal.addEventListener('abort', () => resolve(), { once: true });
              });
              signalWasAborted = signal.aborted;
            },
            onPermanentFailure: async (_job, error) => {
              permanentFailureCodes.push(error.code);
            },
          },
        },
      });
      await started;
      await runner.stop();
      expect(signalWasAborted).toBe(true);
      expect(handledJobIds).toEqual([runnerJobId]);
      expect(permanentFailureCodes).toEqual(['AI_UNAVAILABLE']);

      const [exhausted] = await db
        .select({ status: jobs.status, attemptCount: jobs.attemptCount })
        .from(jobs)
        .where(eq(jobs.id, exhaustedJobId));
      expect(exhausted).toEqual({ status: 'failed', attemptCount: 2 });

      const [interrupted] = await db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, runnerJobId));
      expect(interrupted?.status).toBe('running');
    });
  }, 120_000);
});

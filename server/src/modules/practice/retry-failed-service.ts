import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { jobs, practiceSessions, practiceTargets } from '../../db/schema';
import { beginIdempotentOperation, finishIdempotentOperation } from '../idempotency/service';
import { MAX_TARGETS_PER_ARTICLE } from './topic-targets';

export const retryableGenerationCodes = new Set([
  'AI_UNAVAILABLE', 'AI_INVALID_OUTPUT', 'GENERATION_DEADLINE_EXCEEDED',
]);
const successfulStatuses = new Set(['ready', 'in_progress', 'completed']);

/** A charged group can refill its failed slots once without touching readable articles. */
export async function retryFailedTopicArticles(
  db: AppDatabase,
  input: {
    userId: string;
    groupId: string;
    idempotencyKey: string;
    generationDeadlineMs: number;
  },
): Promise<{ groupId: string }> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx, input.userId, 'retry_failed_topics', input.idempotencyKey,
      { groupId: input.groupId },
    );
    if (replay) return { groupId: replay };

    const [root] = await tx.select({ id: practiceSessions.id, groupId: practiceSessions.topicGroupId })
      .from(practiceSessions)
      .where(and(eq(practiceSessions.id, input.groupId), eq(practiceSessions.userId, input.userId)))
      .for('update').limit(1);
    if (!root || root.groupId !== input.groupId) throw new AppError('NOT_FOUND', '主题练习不存在', 404);
    const members = await tx.select({
      id: practiceSessions.id,
      status: practiceSessions.status,
      failureCode: practiceSessions.failureCode,
      position: practiceSessions.topicPosition,
    }).from(practiceSessions).where(and(
      eq(practiceSessions.topicGroupId, input.groupId),
      eq(practiceSessions.userId, input.userId),
    )).orderBy(asc(practiceSessions.topicPosition)).for('update');
    if (!members.some((member) => successfulStatuses.has(member.status))) {
      throw new AppError('STATE_CONFLICT', '请重新创建一组短文', 409);
    }
    const failedIds = members.filter((member) => member.status === 'failed'
      && retryableGenerationCodes.has(member.failureCode ?? '')).map((member) => member.id);
    if (failedIds.length === 0) throw new AppError('STATE_CONFLICT', '没有可重试的短文', 409);
    const failedJobs = await tx.select({
      id: jobs.id, resourceId: jobs.resourceId, attemptCount: jobs.attemptCount,
      maxAttempts: jobs.maxAttempts, status: jobs.status,
    }).from(jobs).where(and(eq(jobs.kind, 'practice_generation'), inArray(jobs.resourceId, failedIds)))
      .for('update');
    const eligible = failedJobs.filter((job) => job.status === 'failed' && job.maxAttempts === 3);
    if (eligible.length === 0) throw new AppError('STATE_CONFLICT', '这些短文已达到重试上限', 409);
    const now = new Date();
    for (const job of eligible) {
      const member = members.find((entry) => entry.id === job.resourceId)!;
      await trimLegacyTargetSet(tx, job.resourceId, member.position ?? 0);
      await tx.update(practiceSessions).set({
        status: 'queued', generationProgress: 0, failureCode: null, failureMessagePublic: null,
      }).where(eq(practiceSessions.id, job.resourceId));
      await tx.update(jobs).set({
        status: 'queued', maxAttempts: Math.max(4, job.attemptCount + 3),
        availableAt: now, deadlineAt: new Date(now.getTime() + input.generationDeadlineMs * 4),
        lockedAt: null, leaseExpiresAt: null, lockedBy: null,
        lastErrorCode: null, finishedAt: null,
      }).where(eq(jobs.id, job.id));
    }
    await finishIdempotentOperation(tx, input.userId, 'retry_failed_topics', input.idempotencyKey, input.groupId);
    return { groupId: input.groupId };
  });
}

async function trimLegacyTargetSet(
  tx: AppTransaction,
  practiceId: string,
  topicPosition: number,
): Promise<void> {
  const targets = await tx.select({ id: practiceTargets.id }).from(practiceTargets)
    .where(eq(practiceTargets.practiceSessionId, practiceId))
    .orderBy(asc(practiceTargets.position));
  if (targets.length <= MAX_TARGETS_PER_ARTICLE) return;
  const start = topicPosition * MAX_TARGETS_PER_ARTICLE % targets.length;
  const keepIds = Array.from({ length: MAX_TARGETS_PER_ARTICLE }, (_, index) =>
    targets[(start + index) % targets.length]!.id);
  await tx.delete(practiceTargets).where(and(
    eq(practiceTargets.practiceSessionId, practiceId),
    notInArray(practiceTargets.id, keepIds),
  ));
}

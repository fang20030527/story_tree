import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { AppError } from '../../core/errors';
import { jobs, practiceSessions, practiceTargets, usageLedger, vocabularyItems } from '../../db/schema';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import { claimNextJob, markSucceeded, rescheduleOrFail } from '../jobs/repository';
import { submitFirstAnswer } from './answer-service';
import { createPractice } from './create-service';
import { failPracticeGeneration, handlePracticeGeneration } from './generation-handler';
import { getPracticeForUser } from './get-service';
import { upsertExactVocabularyItems } from '../vocabulary/repository';
import { retryFailedTopicArticles } from './retry-failed-service';

const signal = () => ({ signal: new AbortController().signal });

describe('four-topic practice groups', () => {
  it('creates four distinct short articles, replays once and keeps answers independent', async () => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '91'.repeat(32), true);
      const input = {
        userId: user.userId, idempotencyKey: 'topic-group-create-0001',
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
        format: 'topic_set' as const, freeLimit: 1, generationDeadlineMs: 120_000,
      };
      const created = await createPractice(db, input);
      expect((await createPractice(db, input)).practiceId).toBe(created.practiceId);
      const read = (practiceId: string) => getPracticeForUser(db, { userId: user.userId, practiceId, freeLimit: 1 });
      const initial = await read(created.practiceId);
      expect(initial.group?.articles).toHaveLength(4);
      expect(new Set(initial.group!.articles.map((article) => article.topic)).size).toBe(4);
      expect(initial.group?.articles.every((article) => article.status === 'queued')).toBe(true);
      expect(initial.group?.articles.every((article) => article.generationProgress === 0)).toBe(true);
      const claimed = [];
      for (let index = 0; index < 4; index += 1) {
        claimed.push((await claimNextJob(db, `topic-worker-${index}`, 120_000, ['practice_generation']))!);
      }
      const options = { db, provider: new FakeAiProvider(), modelName: 'fake-topic' };
      const firstReadyJob = claimed.find((job) => job.resourceId !== created.practiceId)!;
      await handlePracticeGeneration(options, firstReadyJob, signal());
      const partial = await read(created.practiceId);
      expect(partial.status).toBe('queued');
      expect(partial.group!.articles.filter((article) => article.status === 'ready')).toHaveLength(1);
      expect(partial.group!.articles.find((article) => article.status === 'ready')?.generationProgress).toBe(100);
      expect((await read(firstReadyJob.resourceId)).article).not.toBeNull();
      // Concurrent final writes must still settle quota exactly once.
      await Promise.all(claimed.map((job) => handlePracticeGeneration(options, job, signal())));
      const ready = await read(created.practiceId);
      expect(ready.group!.articles.every((article) => article.status === 'ready')).toBe(true);
      for (const article of ready.group!.articles) {
        expect(article.wordCount).toBeGreaterThanOrEqual(200);
        expect(article.wordCount).toBeLessThanOrEqual(300);
      }
      const chosenId = ready.group!.articles[2]!.id;
      const chosen = await read(chosenId);
      await submitFirstAnswer(db, {
        userId: user.userId, practiceId: chosenId, questionId: chosen.questions[0]!.id,
        idempotencyKey: 'topic-answer-0001', answerKind: 'dont_know', elapsedMs: 2000,
      });
      const after = await read(created.practiceId);
      expect(after.group!.articles[2]!.status).toBe('completed');
      expect(after.group!.articles.filter((article) => article.status === 'ready')).toHaveLength(3);
      expect(after.questions[0]!.submittedAnswer).toBeNull();
      expect((await read(chosenId)).questions[0]!.submittedAnswer?.answerKind).toBe('dont_know');
      expect((await db.select().from(usageLedger)).map((entry) => entry.kind).sort()).toEqual(['commit', 'reserve']);
      const stranger = await registerAnonymous(db, '92'.repeat(32), true);
      await expect(getPracticeForUser(db, { userId: stranger.userId, practiceId: chosenId, freeLimit: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await db.select().from(practiceSessions)).toHaveLength(4);
    });
  }, 120_000);

  it('spreads a stored second meaning into another article while keeping multiple words per article', async () => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '94'.repeat(32), true);
      await db.transaction((tx) => upsertExactVocabularyItems(tx, user.userId, [
        { term: 'bank', meaningZh: '河岸' },
      ]));
      const created = await createPractice(db, {
        userId: user.userId, idempotencyKey: 'topic-polysemy-0001',
        items: [{ term: 'bank', meaningZh: '银行' }, { term: 'river', meaningZh: '河流' }],
        format: 'topic_set', freeLimit: 1, generationDeadlineMs: 120_000,
      });
      const members = await db.select({ id: practiceSessions.id }).from(practiceSessions)
        .where(eq(practiceSessions.topicGroupId, created.practiceId));
      const assignments = await db.select({
        practiceId: practiceTargets.practiceSessionId,
        term: vocabularyItems.normalizedTerm,
        meaning: vocabularyItems.meaningZh,
      }).from(practiceTargets)
        .innerJoin(vocabularyItems, eq(vocabularyItems.id, practiceTargets.vocabularyItemId))
        .where(inArray(practiceTargets.practiceSessionId, members.map((member) => member.id)));
      for (const member of members) {
        const articleWords = assignments.filter((entry) => entry.practiceId === member.id);
        expect(new Set(articleWords.map((entry) => entry.term)).size).toBeGreaterThanOrEqual(2);
      }
      const finance = assignments.find((entry) => entry.term === 'bank' && entry.meaning === '银行');
      const riverside = assignments.find((entry) => entry.term === 'bank' && entry.meaning === '河岸');
      expect(finance).toBeDefined();
      expect(riverside).toBeDefined();
      expect(finance!.practiceId).not.toBe(riverside!.practiceId);
    });
  }, 120_000);

  it('retries only failed topics once within a partially successful paid group', async () => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '95'.repeat(32), true);
      const created = await createPractice(db, {
        userId: user.userId, idempotencyKey: 'topic-refill-create-0001',
        items: [{ term: 'bank', meaningZh: '银行' }, { term: 'river', meaningZh: '河流' }],
        format: 'topic_set', freeLimit: 1, generationDeadlineMs: 120_000,
      });
      const claimed = await Promise.all(Array.from({ length: 4 }, (_, index) =>
        claimNextJob(db, `refill-worker-${index}`, 120_000, ['practice_generation'])));
      const options = { db, provider: new FakeAiProvider(), modelName: 'fake-topic' };
      await handlePracticeGeneration(options, claimed[0]!, signal());
      await markSucceeded(db, claimed[0]!.id, claimed[0]!.lockedBy);
      for (const job of claimed.slice(1)) {
        const error = new AppError('GENERATION_DEADLINE_EXCEEDED', '任务已超过截止时间', 504);
        await failPracticeGeneration(options, job!, error, signal());
        await rescheduleOrFail(db, job!, error);
      }
      const before = await getPracticeForUser(db, {
        userId: user.userId, practiceId: created.practiceId, freeLimit: 1,
      });
      expect(before.group?.canRetryFailed).toBe(true);
      expect(before.group?.articles.filter((article) => article.status === 'ready')).toHaveLength(1);
      const retryInput = {
        userId: user.userId, groupId: created.practiceId,
        idempotencyKey: 'topic-refill-retry-0001', generationDeadlineMs: 120_000,
      };
      await retryFailedTopicArticles(db, retryInput);
      await expect(retryFailedTopicArticles(db, retryInput)).resolves.toEqual({ groupId: created.practiceId });
      const after = await getPracticeForUser(db, {
        userId: user.userId, practiceId: created.practiceId, freeLimit: 1,
      });
      expect(after.group?.canRetryFailed).toBe(false);
      expect(after.group?.articles.filter((article) => article.status === 'queued')).toHaveLength(3);
      expect(after.group?.articles.filter((article) => article.status === 'ready')).toHaveLength(1);
      const groupJobs = await db.select({ status: jobs.status, maxAttempts: jobs.maxAttempts })
        .from(jobs);
      expect(groupJobs.filter((job) => job.status === 'queued' && job.maxAttempts === 4)).toHaveLength(3);
      expect((await db.select().from(usageLedger)).map((entry) => entry.kind).sort())
        .toEqual(['commit', 'reserve']);
      await expect(retryFailedTopicArticles(db, {
        ...retryInput, idempotencyKey: 'topic-refill-retry-0002',
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });
  }, 120_000);

  it.each([false, true])('settles one reservation when all jobs finish (partial success: %s)', async (partialSuccess) => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '93'.repeat(32), true);
      const created = await createPractice(db, {
        userId: user.userId, idempotencyKey: 'topic-failure-0001',
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
        format: 'topic_set', freeLimit: 1, generationDeadlineMs: 120_000,
      });
      const options = { db, provider: new FakeAiProvider(), modelName: 'fake-topic' };
      for (let index = 0; index < 4; index += 1) {
        const job = (await claimNextJob(db, `topic-worker-${index}`, 120_000, ['practice_generation']))!;
        if (partialSuccess && index === 3) {
          await handlePracticeGeneration(options, job, signal());
        } else {
          await failPracticeGeneration(options, job, new AppError('AI_UNAVAILABLE', 'Unavailable', 503), signal());
        }
        const ledger = await db.select().from(usageLedger).where(eq(usageLedger.practiceSessionId, created.practiceId));
        if (index < 3) expect(ledger).toHaveLength(1);
        else expect(ledger.map((entry) => entry.kind).sort()).toEqual(partialSuccess ? ['commit', 'reserve'] : ['release', 'reserve']);
      }
      const result = await getPracticeForUser(db, { userId: user.userId, practiceId: created.practiceId, freeLimit: 1 });
      expect(result.group!.articles.filter((article) => article.status === 'ready')).toHaveLength(partialSuccess ? 1 : 0);
      expect(result.remainingFreePractices).toBe(partialSuccess ? 0 : 1);
    });
  }, 120_000);
});

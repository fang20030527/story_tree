import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { AppError } from '../../core/errors';
import { practiceSessions, usageLedger } from '../../db/schema';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import { claimNextJob } from '../jobs/repository';
import { submitFirstAnswer } from './answer-service';
import { createPractice } from './create-service';
import { failPracticeGeneration, handlePracticeGeneration } from './generation-handler';
import { getPracticeForUser } from './get-service';

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
      const claimed = [];
      for (let index = 0; index < 4; index += 1) {
        claimed.push((await claimNextJob(db, `topic-worker-${index}`, 120_000, ['practice_generation']))!);
      }
      const options = { db, provider: new FakeAiProvider(), modelName: 'fake-topic' };
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

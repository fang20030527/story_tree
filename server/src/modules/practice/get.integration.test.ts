import { describe, expect, it } from 'vitest';

import { PracticeDtoSchema, PublicErrorSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import { claimNextJob } from '../jobs/repository';
import { createPractice } from './create-service';
import { handlePracticeGeneration } from './generation-handler';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  FREE_PRACTICE_LIMIT: '3',
});

describe('practice retrieval', () => {
  it('returns durable status and never exposes unanswered feedback', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '81'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '82'.repeat(32);
      await registerAnonymous(db, otherToken, true);
      const created = await createPractice(db, {
        userId: owner.userId,
        idempotencyKey: 'get-practice-000001',
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
        freeLimit: 3,
        generationDeadlineMs: 120_000,
      });
      const app = buildApp({ config, db, logger: false });

      try {
        const queuedResponse = await app.inject({
          method: 'GET',
          url: `/v1/practices/${created.practiceId}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(queuedResponse.statusCode).toBe(200);
        expect(PracticeDtoSchema.parse(queuedResponse.json())).toMatchObject({
          id: created.practiceId,
          status: 'queued',
          modelName: null,
          pollAfterMs: 1_500,
          failure: null,
          article: null,
          questions: [],
        });

        const job = await claimNextJob(
          db,
          'get-practice-worker',
          60_000,
          ['practice_generation'],
        );
        await handlePracticeGeneration(
          { db, provider: new FakeAiProvider(), modelName: 'fake-ielts-v1' },
          job!,
          { signal: new AbortController().signal },
        );

        const readyResponse = await app.inject({
          method: 'GET',
          url: `/v1/practices/${created.practiceId}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(readyResponse.statusCode).toBe(200);
        const ready = PracticeDtoSchema.parse(readyResponse.json());
        expect(ready).toMatchObject({
          id: created.practiceId,
          status: 'ready',
          modelName: 'fake-ielts-v1',
          failure: null,
        });
        expect(ready.pollAfterMs).toBeUndefined();
        expect(ready.article?.paragraphs).toHaveLength(3);
        expect(ready.questions).toHaveLength(1);
        expect(ready.questions[0]).toMatchObject({
          term: 'resilient',
          options: expect.arrayContaining([
            expect.objectContaining({ label: '有韧性的' }),
          ]),
          submittedAnswer: null,
        });
        const serialized = readyResponse.body;
        expect(serialized).not.toContain('correctOptionId');
        expect(serialized).not.toContain('meaningEn');
        expect(serialized).not.toContain('explanationZh');
        expect(serialized).not.toContain('optionExplanations');

        const forbidden = await app.inject({
          method: 'GET',
          url: `/v1/practices/${created.practiceId}`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(forbidden.statusCode).toBe(404);
        expect(PublicErrorSchema.parse(forbidden.json()).error.code).toBe(
          'NOT_FOUND',
        );
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});

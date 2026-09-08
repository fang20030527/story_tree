import { describe, expect, it, vi } from 'vitest';

import { TranslationDtoSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import {
  assistanceEvents,
  jobs,
  practiceParagraphs,
  practiceSessions,
  translations,
} from '../../db/schema';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import {
  claimNextJob,
  markSucceeded,
  rescheduleOrFail,
} from '../jobs/repository';
import { failTranslation, handleTranslation } from './handler';
import { getTranslationForUser, requestTranslation } from './service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
  GENERATION_DEADLINE_MS: '120000',
});

describe('cached asynchronous translations', () => {
  it('deduplicates cache work, enforces ownership, and returns only ready text', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '91'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '92'.repeat(32);
      const other = await registerAnonymous(db, otherToken, true);
      const ownerPractice = await seedReadyPractice(db, owner.userId, [
        'A resilient community studies careful adaptation.',
        'A second paragraph provides measured evidence.',
      ]);
      const otherPractice = await seedReadyPractice(db, other.userId, [
        'This paragraph belongs to another reader.',
      ]);

      const paragraphRequest = {
        userId: owner.userId,
        practiceId: ownerPractice.id,
        request: {
          scope: 'paragraph' as const,
          paragraphId: ownerPractice.paragraphIds[0]!,
        },
        deadlineMs: 120_000,
      };
      const [first, concurrent] = await Promise.all([
        requestTranslation(db, {
          ...paragraphRequest,
          idempotencyKey: 'translation-cache-0001',
        }),
        requestTranslation(db, {
          ...paragraphRequest,
          idempotencyKey: 'translation-cache-0002',
        }),
      ]);
      expect(first.id).toBe(concurrent.id);
      expect(first).toMatchObject({
        status: 'queued',
        translatedTextZh: null,
        pollAfterMs: 1_500,
        failure: null,
      });

      const replay = await requestTranslation(db, {
        ...paragraphRequest,
        idempotencyKey: 'translation-cache-0001',
      });
      expect(replay.id).toBe(first.id);
      expect(await db.select().from(translations)).toHaveLength(1);
      expect(await db.select().from(jobs)).toHaveLength(1);
      expect(await db.select().from(assistanceEvents)).toHaveLength(0);

      await expect(
        requestTranslation(db, {
          ...paragraphRequest,
          request: { scope: 'full' },
          idempotencyKey: 'translation-cache-0001',
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      await expect(
        requestTranslation(db, {
          ...paragraphRequest,
          request: {
            scope: 'paragraph',
            paragraphId: otherPractice.paragraphIds[0]!,
          },
          idempotencyKey: 'translation-foreign-001',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const full = await requestTranslation(db, {
        userId: owner.userId,
        practiceId: ownerPractice.id,
        request: { scope: 'full' },
        idempotencyKey: 'translation-full-00001',
        deadlineMs: 120_000,
      });
      expect(full.id).not.toBe(first.id);
      expect(await db.select().from(translations)).toHaveLength(2);
      expect(await db.select().from(jobs)).toHaveLength(2);

      const provider = new FakeAiProvider();
      const translate = vi.spyOn(provider, 'translate');
      for (let index = 0; index < 2; index += 1) {
        const job = await claimNextJob(
          db,
          `translation-worker-${index}`,
          60_000,
          ['translation'],
        );
        expect(job).not.toBeNull();
        await handleTranslation(
          { db, provider },
          job!,
          { signal: new AbortController().signal },
        );
        expect(await markSucceeded(db, job!.id, job!.lockedBy)).toBe(true);
      }
      expect(translate).toHaveBeenCalledTimes(2);

      const ready = await getTranslationForUser(db, {
        userId: owner.userId,
        translationId: first.id,
      });
      expect(ready.status).toBe('ready');
      expect(ready.translatedTextZh).toMatch(/^译文：/u);
      expect(ready.pollAfterMs).toBeUndefined();
      await expect(
        getTranslationForUser(db, {
          userId: other.userId,
          translationId: first.id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const app = buildApp({ config, db, logger: false });
      try {
        const cachedResponse = await app.inject({
          method: 'POST',
          url: `/v1/practices/${ownerPractice.id}/translations`,
          headers: {
            authorization: `Bearer ${ownerToken}`,
            'idempotency-key': 'translation-http-0001',
          },
          payload: paragraphRequest.request,
        });
        expect(cachedResponse.statusCode).toBe(200);
        expect(TranslationDtoSchema.parse(cachedResponse.json()).id).toBe(first.id);

        const response = await app.inject({
          method: 'GET',
          url: `/v1/translations/${first.id}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(response.statusCode).toBe(200);
        expect(TranslationDtoSchema.parse(response.json())).toEqual(ready);
      } finally {
        await app.close();
      }

      const failing = await requestTranslation(db, {
        ...paragraphRequest,
        request: {
          scope: 'paragraph',
          paragraphId: ownerPractice.paragraphIds[1]!,
        },
        idempotencyKey: 'translation-failing-01',
      });
      const failingJob = await claimNextJob(
        db,
        'translation-failure-worker',
        60_000,
        ['translation'],
      );
      expect(failingJob?.resourceId).toBe(failing.id);
      const unsafeProvider = new FakeAiProvider();
      vi.spyOn(unsafeProvider, 'moderate').mockResolvedValue({
        riskLevel: 'low',
        flagged: true,
      });
      const failure = await captureAppError(
        handleTranslation(
          { db, provider: unsafeProvider },
          failingJob!,
          { signal: new AbortController().signal },
        ),
      );
      expect(failure).toMatchObject({
        code: 'AI_CONTENT_REJECTED',
        retryable: true,
      });
      const exhaustedJob = {
        ...failingJob!,
        attemptCount: failingJob!.maxAttempts,
      };
      await failTranslation(
        { db },
        exhaustedJob,
        failure,
        { signal: new AbortController().signal },
      );
      expect(await rescheduleOrFail(db, exhaustedJob, failure)).toBe('failed');

      const failed = await getTranslationForUser(db, {
        userId: owner.userId,
        translationId: failing.id,
      });
      expect(failed).toEqual({
        id: failing.id,
        status: 'failed',
        scope: 'paragraph',
        paragraphId: ownerPractice.paragraphIds[1],
        translatedTextZh: null,
        failure: {
          code: 'AI_UNAVAILABLE',
          message: '翻译暂时无法完成',
          retryable: true,
        },
      });
      expect(JSON.stringify(failed)).not.toContain('AI_CONTENT_REJECTED');

      const retried = await requestTranslation(db, {
        ...paragraphRequest,
        request: {
          scope: 'paragraph',
          paragraphId: ownerPractice.paragraphIds[1]!,
        },
        idempotencyKey: 'translation-retry-0001',
      });
      expect(retried).toMatchObject({ id: failing.id, status: 'queued' });
      expect(await db.select().from(translations)).toHaveLength(3);
      expect(await db.select().from(jobs)).toHaveLength(4);
      expect(await db.select().from(assistanceEvents)).toHaveLength(0);
    });
  }, 120_000);
});

async function captureAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
    throw new Error('Expected an AppError');
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return error;
  }
}

async function seedReadyPractice(
  db: Parameters<typeof requestTranslation>[0],
  userId: string,
  paragraphTexts: string[],
): Promise<{ id: string; paragraphIds: string[] }> {
  const id = crypto.randomUUID();
  await db.insert(practiceSessions).values({
    id,
    userId,
    examPath: 'ielts',
    status: 'ready',
    articleTitle: 'A safe practice',
    articleWordCount: 700,
    modelName: 'fake',
    promptVersion: 'test-v1',
    readyAt: new Date(),
  });
  const paragraphIds = paragraphTexts.map(() => crypto.randomUUID());
  await db.insert(practiceParagraphs).values(
    paragraphTexts.map((plainText, position) => ({
      id: paragraphIds[position]!,
      practiceSessionId: id,
      position,
      plainText,
    })),
  );
  return { id, paragraphIds };
}

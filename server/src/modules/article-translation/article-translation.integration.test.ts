import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  ArticleTranslationDtoSchema,
  PublicErrorSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  articleParagraphs,
  articleTranslations,
  assistanceEvents,
  importedArticles,
  jobs,
  translations,
} from '../../db/schema';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import { claimNextJob, markSucceeded } from '../jobs/repository';
import {
  failArticleTranslation,
  handleArticleTranslation,
} from './handler';
import {
  getArticleTranslationForUser,
  requestArticleTranslation,
} from './service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
  GENERATION_DEADLINE_MS: '120000',
});

describe('article translation cache', () => {
  it('deduplicates owner-scoped paragraph/full work and keeps its cache separate', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '63'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '64'.repeat(32);
      const other = await registerAnonymous(db, otherToken, true);
      const ownerArticle = await seedArticle(db, owner.userId, '1');
      const otherArticle = await seedArticle(db, other.userId, '2');
      const app = buildApp({ config, db, logger: false });

      try {
        const request = {
          scope: 'paragraph' as const,
          paragraphId: ownerArticle.paragraphIds[0]!,
        };
        const [firstResponse, concurrentResponse] = await Promise.all([
          app.inject({
            method: 'POST',
            url: `/v1/articles/${ownerArticle.id}/translations`,
            headers: authHeaders(ownerToken, 'article-translation-0001'),
            payload: request,
          }),
          app.inject({
            method: 'POST',
            url: `/v1/articles/${ownerArticle.id}/translations`,
            headers: authHeaders(ownerToken, 'article-translation-0002'),
            payload: request,
          }),
        ]);
        expect(firstResponse.statusCode).toBe(202);
        expect(concurrentResponse.statusCode).toBe(202);
        const first = ArticleTranslationDtoSchema.parse(firstResponse.json());
        expect(ArticleTranslationDtoSchema.parse(concurrentResponse.json()).id)
          .toBe(first.id);
        expect(first).toMatchObject({
          status: 'queued',
          translatedTextZh: null,
          pollAfterMs: 1_500,
          failure: null,
        });
        expect(await db.select().from(articleTranslations)).toHaveLength(1);
        expect(await db.select().from(jobs)).toHaveLength(1);

        const changedReplay = await app.inject({
          method: 'POST',
          url: `/v1/articles/${ownerArticle.id}/translations`,
          headers: authHeaders(ownerToken, 'article-translation-0001'),
          payload: { scope: 'full' },
        });
        expect(PublicErrorSchema.parse(changedReplay.json()).error.code).toBe(
          'IDEMPOTENCY_KEY_REUSED',
        );

        const fullResponse = await app.inject({
          method: 'POST',
          url: `/v1/articles/${ownerArticle.id}/translations`,
          headers: authHeaders(ownerToken, 'article-translation-full-01'),
          payload: { scope: 'full' },
        });
        expect(fullResponse.statusCode).toBe(202);
        const full = ArticleTranslationDtoSchema.parse(fullResponse.json());
        expect(full.id).not.toBe(first.id);

        const foreignArticle = await app.inject({
          method: 'POST',
          url: `/v1/articles/${otherArticle.id}/translations`,
          headers: authHeaders(ownerToken, 'article-translation-foreign'),
          payload: { scope: 'full' },
        });
        expect(foreignArticle.statusCode).toBe(404);
        const foreignParagraph = await app.inject({
          method: 'POST',
          url: `/v1/articles/${ownerArticle.id}/translations`,
          headers: authHeaders(ownerToken, 'article-translation-paragraph'),
          payload: {
            scope: 'paragraph',
            paragraphId: otherArticle.paragraphIds[0],
          },
        });
        expect(foreignParagraph.statusCode).toBe(404);

        const provider = new FakeAiProvider();
        const translate = vi.spyOn(provider, 'translate');
        for (let index = 0; index < 2; index += 1) {
          const job = await claimNextJob(
            db,
            `article-translation-worker-${index}`,
            60_000,
            ['article_translation'],
          );
          expect(job).not.toBeNull();
          await handleArticleTranslation(
            { db, provider },
            job!,
            { signal: new AbortController().signal },
          );
          expect(await markSucceeded(db, job!.id, job!.lockedBy)).toBe(true);
        }
        expect(translate).toHaveBeenCalledTimes(2);

        const ready = await getArticleTranslationForUser(db, {
          userId: owner.userId,
          translationId: first.id,
        });
        expect(ready.status).toBe('ready');
        expect(ready.translatedTextZh).toMatch(/^\u8bd1\u6587：/u);
        await expect(
          getArticleTranslationForUser(db, {
            userId: other.userId,
            translationId: first.id,
          }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(await db.select().from(translations)).toHaveLength(0);
        expect(await db.select().from(assistanceEvents)).toHaveLength(0);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('requires an active lease for ready and permanent-failure writes', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '65'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const article = await seedArticle(db, owner.userId, '3');
      const translation = await requestArticleTranslation(db, {
        userId: owner.userId,
        articleId: article.id,
        request: {
          scope: 'paragraph',
          paragraphId: article.paragraphIds[0]!,
        },
        idempotencyKey: 'article-translation-lease-1',
        deadlineMs: 120_000,
      });
      const job = await claimNextJob(
        db,
        'article-translation-lost-lease',
        60_000,
        ['article_translation'],
      );
      expect(job?.resourceId).toBe(translation.id);
      await db.update(jobs).set({ lockedBy: 'another-worker' }).where(eq(jobs.id, job!.id));

      await expect(
        handleArticleTranslation(
          { db, provider: new FakeAiProvider() },
          job!,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      await expect(
        failArticleTranslation(
          { db },
          job!,
          new Error('hidden') as never,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      const [preserved] = await db
        .select()
        .from(articleTranslations)
        .where(eq(articleTranslations.id, translation.id));
      expect(preserved?.status).toBe('queued');
    });
  }, 120_000);
});

function authHeaders(token: string, idempotencyKey: string) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': idempotencyKey,
  };
}

async function seedArticle(
  db: Parameters<typeof requestArticleTranslation>[0],
  userId: string,
  suffix: string,
): Promise<{ id: string; paragraphIds: string[] }> {
  const id = crypto.randomUUID();
  await db.insert(importedArticles).values({
    id,
    userId,
    sourceKind: 'paste',
    sourceUrl: null,
    title: `Synthetic article ${suffix}`,
    wordCount: 24,
    contentHash: suffix.repeat(64).slice(0, 64),
    similarityFingerprint: BigInt(Number(suffix)),
    importedAt: new Date(),
  });
  const paragraphIds = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(articleParagraphs).values([
    {
      id: paragraphIds[0],
      articleId: id,
      position: 0,
      plainText:
        'Careful readers inspect original evidence before making a conclusion.',
    },
    {
      id: paragraphIds[1],
      articleId: id,
      position: 1,
      plainText:
        'They compare context and update their reasoning when new facts appear.',
    },
  ]);
  return { id, paragraphIds };
}

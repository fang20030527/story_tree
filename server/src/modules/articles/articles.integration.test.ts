import { describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';

import {
  ImportedArticleDtoSchema,
  ImportedArticlePageSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import type { AppDatabase } from '../../db/client';
import {
  answerAttempts,
  articleImports,
  articleParagraphs,
  articleTranslations,
  computerUploadSessions,
  importAssets,
  importedArticles,
  jobs,
  learningProgress,
  practiceParagraphs,
  practiceQuestions,
  practiceSessions,
  practiceTargets,
  vocabularyItems,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});

const FIRST_PARAGRAPH =
  'Careful readers compare several sources before accepting a public claim.';
const SECOND_PARAGRAPH =
  'They preserve context and revise conclusions when stronger evidence appears.';

async function seedArticle(
  db: AppDatabase,
  input: {
    id: string;
    userId: string;
    title: string;
    hashByte: string;
    importedAt: Date;
    createdAt?: Date;
  },
): Promise<void> {
  await db.insert(importedArticles).values({
    id: input.id,
    userId: input.userId,
    sourceKind: 'paste',
    sourceUrl: null,
    title: input.title,
    wordCount: 20,
    contentHash: input.hashByte.repeat(64),
    similarityFingerprint: BigInt(`0x${input.hashByte.repeat(8)}`) % (1n << 63n),
    importedAt: input.importedAt,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
  await db.insert(articleParagraphs).values({
    id: crypto.randomUUID(),
    articleId: input.id,
    position: 0,
    plainText: FIRST_PARAGRAPH,
  });
}

async function seedDeleteGraph(
  db: AppDatabase,
  userId: string,
): Promise<{
  articleId: string;
  importId: string;
  paragraphIds: string[];
  translationIds: string[];
  vocabularyItemId: string;
  practiceId: string;
  answerAttemptId: string;
}> {
  const articleId = crypto.randomUUID();
  const importId = crypto.randomUUID();
  const paragraphIds = [crypto.randomUUID(), crypto.randomUUID()];
  const translationIds = [crypto.randomUUID(), crypto.randomUUID()];
  const vocabularyItemId = crypto.randomUUID();
  const practiceId = crypto.randomUUID();
  const practiceParagraphId = crypto.randomUUID();
  const practiceTargetId = crypto.randomUUID();
  const practiceQuestionId = crypto.randomUUID();
  const correctOptionId = crypto.randomUUID();
  const answerAttemptId = crypto.randomUUID();
  const now = new Date('2026-09-12T08:00:00.000Z');

  await db.insert(importedArticles).values({
    id: articleId,
    userId,
    sourceKind: 'computer',
    sourceUrl: null,
    title: 'Delete me',
    wordCount: 20,
    contentHash: 'd'.repeat(64),
    similarityFingerprint: 44n,
    importedAt: now,
    createdAt: now,
  });
  await db.insert(articleParagraphs).values([
    { id: paragraphIds[0]!, articleId, position: 0, plainText: FIRST_PARAGRAPH },
    { id: paragraphIds[1]!, articleId, position: 1, plainText: SECOND_PARAGRAPH },
  ]);
  await db.insert(articleTranslations).values([
    {
      id: translationIds[0]!,
      articleId,
      scope: 'full',
      paragraphId: null,
      sourceHash: 'e'.repeat(64),
      status: 'queued',
    },
    {
      id: translationIds[1]!,
      articleId,
      scope: 'paragraph',
      paragraphId: paragraphIds[0]!,
      sourceHash: 'f'.repeat(64),
      status: 'queued',
    },
  ]);
  await db.insert(articleImports).values({
    id: importId,
    userId,
    sourceKind: 'computer',
    status: 'confirmed',
    previewTitle: 'Delete me',
    previewText: FIRST_PARAGRAPH,
    wordCount: 20,
    contentHash: 'd'.repeat(64),
    similarityFingerprint: 44n,
    articleId,
    previewReadyAt: now,
    confirmedAt: now,
    expiresAt: new Date('2026-09-19T08:00:00.000Z'),
  });
  await db.insert(importAssets).values({
    articleImportId: importId,
    position: 0,
    mediaType: 'text/plain',
    byteSize: 1,
    sha256: '7'.repeat(64),
    content: Buffer.from('x'),
  });
  await db.insert(computerUploadSessions).values({
    userId,
    articleImportId: importId,
    codeHash: '8'.repeat(64),
    status: 'uploaded',
    claimedAt: now,
    uploadedAt: now,
    expiresAt: new Date('2026-09-19T08:00:00.000Z'),
  });
  await db.insert(jobs).values([
    {
      kind: 'article_import',
      resourceId: importId,
      status: 'succeeded',
      deadlineAt: new Date('2026-09-12T08:05:00.000Z'),
      finishedAt: now,
    },
    {
      kind: 'article_translation',
      resourceId: translationIds[0]!,
      status: 'queued',
      deadlineAt: new Date('2026-09-12T08:05:00.000Z'),
    },
    {
      kind: 'article_translation',
      resourceId: translationIds[1]!,
      status: 'queued',
      deadlineAt: new Date('2026-09-12T08:05:00.000Z'),
    },
  ]);
  await db.insert(vocabularyItems).values({
    id: vocabularyItemId,
    userId,
    term: 'durable',
    normalizedTerm: 'durable',
    meaningZh: '持久的',
    normalizedMeaningZh: '持久的',
    sourceSentence: FIRST_PARAGRAPH,
    fingerprint: `delete-test-${articleId}`,
    status: 'reviewing',
  });
  await db.insert(learningProgress).values({
    vocabularyItemId,
    practiceCount: 2,
    firstTryCorrectCount: 1,
    assistedCount: 1,
    lastPracticedAt: now,
  });
  await db.insert(practiceSessions).values({
    id: practiceId,
    userId,
    examPath: 'ielts',
    status: 'ready',
    articleTitle: 'Independent practice evidence',
    articleWordCount: 320,
    modelName: 'fake',
    promptVersion: 'delete-preservation-v1',
    readyAt: now,
  });
  await db.insert(practiceParagraphs).values({
    id: practiceParagraphId,
    practiceSessionId: practiceId,
    position: 0,
    plainText: 'Durable evidence remains available after source cleanup.',
  });
  await db.insert(practiceTargets).values({
    id: practiceTargetId,
    practiceSessionId: practiceId,
    vocabularyItemId,
    position: 0,
    paragraphId: practiceParagraphId,
    surfaceForm: 'Durable',
    startOffset: 0,
    endOffset: 7,
  });
  await db.insert(practiceQuestions).values({
    id: practiceQuestionId,
    practiceTargetId,
    prompt: 'What does durable mean here?',
    optionsJson: [
      { id: correctOptionId, label: '持久的' },
      { id: crypto.randomUUID(), label: '暂时的' },
    ],
    correctOptionId,
    meaningEn: 'able to last',
    explanationZh: '该词在语境中表示能长期保留。',
    optionExplanationsJson: {
      [correctOptionId]: '符合语境。',
    },
  });
  await db.insert(answerAttempts).values({
    id: answerAttemptId,
    practiceSessionId: practiceId,
    practiceQuestionId,
    userId,
    answerKind: 'dont_know',
    selectedOptionId: null,
    isCorrect: false,
    wasAssisted: false,
    elapsedMs: 1_000,
    idempotencyKey: `delete-preservation-${articleId}`,
  });
  return {
    articleId,
    importId,
    paragraphIds,
    translationIds,
    vocabularyItemId,
    practiceId,
    answerAttemptId,
  };
}

describe('private imported articles', () => {
  it('returns ordered paragraphs only to the owning user', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '61'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '62'.repeat(32);
      await registerAnonymous(db, otherToken, true);
      const articleId = crypto.randomUUID();
      await db.insert(importedArticles).values({
        id: articleId,
        userId: owner.userId,
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'A private synthetic article',
        wordCount: 20,
        contentHash: 'a'.repeat(64),
        similarityFingerprint: 1n,
        importedAt: new Date('2026-09-08T00:00:00.000Z'),
      });
      await db.insert(articleParagraphs).values([
        {
          id: crypto.randomUUID(),
          articleId,
          position: 1,
          plainText: SECOND_PARAGRAPH,
        },
        {
          id: crypto.randomUUID(),
          articleId,
          position: 0,
          plainText: FIRST_PARAGRAPH,
        },
      ]);

      const app = buildApp({ config, db, logger: false });
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/articles/${articleId}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(response.statusCode).toBe(200);
        const article = ImportedArticleDtoSchema.parse(response.json());
        expect(article.paragraphs.map(({ position }) => position)).toEqual([
          0, 1,
        ]);
        expect(article.paragraphs.map(({ text }) => text)).toEqual([
          FIRST_PARAGRAPH,
          SECOND_PARAGRAPH,
        ]);

        const hidden = await app.inject({
          method: 'GET',
          url: `/v1/articles/${articleId}`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(hidden.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('lists only owner articles with stable cursor pagination and strict query validation', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '63'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '64'.repeat(32);
      const other = await registerAnonymous(db, otherToken, true);

      const oldestId = '11111111-1111-4111-8111-111111111111';
      const middleId = '22222222-2222-4222-8222-222222222222';
      const newestId = '33333333-3333-4333-8333-333333333333';
      const otherId = '44444444-4444-4444-8444-444444444444';
      const timestamps = [
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
        new Date('2026-09-03T00:00:00.000Z'),
      ] as const;

      await seedArticle(db, {
        id: oldestId,
        userId: owner.userId,
        title: 'Oldest article',
        hashByte: 'aa',
        importedAt: timestamps[0],
        createdAt: timestamps[0],
      });
      await seedArticle(db, {
        id: middleId,
        userId: owner.userId,
        title: 'Middle article',
        hashByte: 'bb',
        importedAt: timestamps[1],
        createdAt: timestamps[2],
      });
      await seedArticle(db, {
        id: newestId,
        userId: owner.userId,
        title: 'Newest article',
        hashByte: 'cc',
        importedAt: timestamps[2],
        createdAt: timestamps[2],
      });
      await seedArticle(db, {
        id: otherId,
        userId: other.userId,
        title: 'Someone else article',
        hashByte: 'dd',
        importedAt: timestamps[2],
        createdAt: timestamps[2],
      });

      const app = buildApp({ config, db, logger: false });
      try {
        const firstPageResponse = await app.inject({
          method: 'GET',
          url: '/v1/articles?limit=2',
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(firstPageResponse.statusCode).toBe(200);
        const firstPage = ImportedArticlePageSchema.parse(
          firstPageResponse.json(),
        );
        expect(firstPage.items.map(({ id }) => id)).toEqual([
          newestId,
          middleId,
        ]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPageResponse = await app.inject({
          method: 'GET',
          url: `/v1/articles?limit=2&cursor=${encodeURIComponent(
            firstPage.nextCursor ?? '',
          )}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(secondPageResponse.statusCode).toBe(200);
        const secondPage = ImportedArticlePageSchema.parse(
          secondPageResponse.json(),
        );
        expect(secondPage.items.map(({ id }) => id)).toEqual([oldestId]);
        expect(secondPage.nextCursor).toBeNull();

        const allIds = [...firstPage.items, ...secondPage.items].map(
          ({ id }) => id,
        );
        expect(allIds).not.toContain(otherId);

        const otherPageResponse = await app.inject({
          method: 'GET',
          url: '/v1/articles',
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(otherPageResponse.statusCode).toBe(200);
        const otherPage = ImportedArticlePageSchema.parse(
          otherPageResponse.json(),
        );
        expect(otherPage.items.map(({ id }) => id)).toEqual([otherId]);

        const unauthenticated = await app.inject({
          method: 'GET',
          url: '/v1/articles',
        });
        expect(unauthenticated.statusCode).toBe(401);

        for (const url of [
          '/v1/articles?cursor=',
          '/v1/articles?cursor=e30%3D',
          '/v1/articles?limit=0',
          '/v1/articles?limit=101',
          '/v1/articles?limit=two',
          '/v1/articles?limit=1.5',
        ]) {
          const invalid = await app.inject({
            method: 'GET',
            url,
            headers: { authorization: `Bearer ${ownerToken}` },
          });
          expect(invalid.statusCode).toBe(400);
        }
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('paginates articles that share a millisecond without skipping rows', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '65'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);

      const earlierId = '55555555-5555-4555-8555-555555555555';
      const laterId = '66666666-6666-4666-8666-666666666666';
      const importedAt = new Date('2026-01-01T00:00:00.000Z');

      await seedArticle(db, {
        id: earlierId,
        userId: owner.userId,
        title: 'Earlier microsecond article',
        hashByte: 'ee',
        importedAt,
      });
      await seedArticle(db, {
        id: laterId,
        userId: owner.userId,
        title: 'Later microsecond article',
        hashByte: 'ff',
        importedAt,
      });
      // JS Dates truncate to milliseconds, so force distinct microsecond
      // created_at values directly in Postgres.
      await db.execute(
        sql`UPDATE imported_articles SET created_at = '2026-01-01T00:00:05.000123Z'::timestamptz WHERE id = ${earlierId}`,
      );
      await db.execute(
        sql`UPDATE imported_articles SET created_at = '2026-01-01T00:00:05.000456Z'::timestamptz WHERE id = ${laterId}`,
      );

      const app = buildApp({ config, db, logger: false });
      try {
        const firstPageResponse = await app.inject({
          method: 'GET',
          url: '/v1/articles?limit=1',
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(firstPageResponse.statusCode).toBe(200);
        const firstPage = ImportedArticlePageSchema.parse(
          firstPageResponse.json(),
        );
        expect(firstPage.items.map(({ id }) => id)).toEqual([laterId]);
        expect(firstPage.nextCursor).not.toBeNull();

        const secondPageResponse = await app.inject({
          method: 'GET',
          url: `/v1/articles?limit=1&cursor=${encodeURIComponent(
            firstPage.nextCursor ?? '',
          )}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(secondPageResponse.statusCode).toBe(200);
        const secondPage = ImportedArticlePageSchema.parse(
          secondPageResponse.json(),
        );
        expect(secondPage.items.map(({ id }) => id)).toEqual([earlierId]);
        expect(secondPage.nextCursor).toBeNull();
      } finally {
        await app.close();
      }
  });
}, 120_000);

  it('permanently deletes only an owned article graph and preserves learning evidence', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '73'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const otherToken = '74'.repeat(32);
      await registerAnonymous(db, otherToken, true);
      const graph = await seedDeleteGraph(db, owner.userId);
      const successorId = crypto.randomUUID();
      await db.insert(importedArticles).values({
        id: successorId,
        userId: owner.userId,
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'Successor article',
        wordCount: 20,
        contentHash: '9'.repeat(64),
        similarityFingerprint: 99n,
        previousVersionId: graph.articleId,
        importedAt: new Date('2026-09-12T09:00:00.000Z'),
      });

      const app = buildApp({ config, db, logger: false });
      try {
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: `/v1/articles/${graph.articleId}`,
            })
          ).statusCode,
        ).toBe(401);

        const hidden = await app.inject({
          method: 'DELETE',
          url: `/v1/articles/${graph.articleId}`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(hidden.statusCode).toBe(204);
        expect(
          await db
            .select()
            .from(importedArticles)
            .where(eq(importedArticles.id, graph.articleId)),
        ).toHaveLength(1);

        const malformed = await app.inject({
          method: 'DELETE',
          url: '/v1/articles/not-a-uuid',
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(malformed.statusCode).toBe(400);

        const deleted = await app.inject({
          method: 'DELETE',
          url: `/v1/articles/${graph.articleId}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(deleted.statusCode).toBe(204);
        expect(deleted.body).toBe('');

        const repeated = await app.inject({
          method: 'DELETE',
          url: `/v1/articles/${graph.articleId}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(repeated.statusCode).toBe(204);
        const missing = await app.inject({
          method: 'DELETE',
          url: `/v1/articles/${crypto.randomUUID()}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        });
        expect(missing.statusCode).toBe(204);

        expect(
          await db
            .select()
            .from(importedArticles)
            .where(eq(importedArticles.id, graph.articleId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(articleParagraphs)
            .where(eq(articleParagraphs.articleId, graph.articleId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(articleTranslations)
            .where(eq(articleTranslations.articleId, graph.articleId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(articleImports)
            .where(eq(articleImports.articleId, graph.articleId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, graph.importId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(computerUploadSessions)
            .where(eq(computerUploadSessions.articleImportId, graph.importId)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(jobs)
            .where(
              inArray(jobs.resourceId, [graph.importId, ...graph.translationIds]),
            ),
        ).toHaveLength(0);

        const [successor] = await db
          .select()
          .from(importedArticles)
          .where(eq(importedArticles.id, successorId));
        expect(successor?.previousVersionId).toBeNull();
        expect(
          await db
            .select()
            .from(vocabularyItems)
            .where(eq(vocabularyItems.id, graph.vocabularyItemId)),
        ).toHaveLength(1);
        expect(
          await db
            .select()
            .from(learningProgress)
            .where(eq(learningProgress.vocabularyItemId, graph.vocabularyItemId)),
        ).toHaveLength(1);
        expect(
          await db
            .select()
            .from(practiceSessions)
            .where(eq(practiceSessions.id, graph.practiceId)),
        ).toHaveLength(1);
        expect(
          await db
            .select()
            .from(answerAttempts)
            .where(eq(answerAttempts.id, graph.answerAttemptId)),
        ).toHaveLength(1);
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});

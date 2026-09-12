import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import {
  ImportedArticleDtoSchema,
  ImportedArticlePageSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import type { AppDatabase } from '../../db/client';
import { articleParagraphs, importedArticles } from '../../db/schema';
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
});

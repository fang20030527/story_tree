import { describe, expect, it } from 'vitest';

import { ImportedArticleDtoSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
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
});

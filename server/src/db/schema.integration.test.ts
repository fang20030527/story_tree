import { asc } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { withTestDatabase } from '../../test/database';
import { jobKinds } from '../modules/jobs/types';
import {
  articleImports,
  articleParagraphs,
  articleTranslations,
  computerUploadSessions,
  importedArticles,
  importAssets,
  jobs,
  practiceSessions,
  users,
} from './schema';

it('migrates an isolated schema and writes a durable practice job', async () => {
  await withTestDatabase(async ({ db, schemaName }) => {
    expect(schemaName).toMatch(/^app_test_[0-9a-f]{32}$/);

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
    await db.insert(jobs).values({
      id: crypto.randomUUID(),
      kind: 'practice_generation',
      resourceId: practiceId,
      status: 'queued',
      maxAttempts: 3,
      availableAt: new Date(),
      deadlineAt: new Date(Date.now() + 120_000),
    });

    expect(await db.select().from(jobs)).toHaveLength(1);
  });
}, 120_000);

it('persists constrained article import resources and both worker kinds', async () => {
  await withTestDatabase(async ({ db }) => {
    const ownerId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    await db.insert(users).values([
      {
        id: ownerId,
        kind: 'guest',
        ageConfirmedAt: new Date(),
      },
      {
        id: otherId,
        kind: 'guest',
        ageConfirmedAt: new Date(),
      },
    ]);

    const articleId = crypto.randomUUID();
    const contentHash = 'a'.repeat(64);
    await db.insert(importedArticles).values({
      id: articleId,
      userId: ownerId,
      sourceKind: 'paste',
      sourceUrl: null,
      title: 'A synthetic article',
      wordCount: 20,
      contentHash,
      similarityFingerprint: 1n,
      importedAt: new Date(),
    });
    const paragraphIds = [crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(articleParagraphs).values([
      {
        id: paragraphIds[1],
        articleId,
        position: 1,
        plainText: 'The second synthetic paragraph preserves its order.',
      },
      {
        id: paragraphIds[0],
        articleId,
        position: 0,
        plainText: 'The first synthetic paragraph begins the article.',
      },
    ]);
    expect(
      (
        await db
          .select()
          .from(articleParagraphs)
          .orderBy(asc(articleParagraphs.position))
      ).map((row) => row.position),
    ).toEqual([0, 1]);

    await db.insert(articleTranslations).values([
      {
        articleId,
        scope: 'full',
        paragraphId: null,
        sourceHash: 'b'.repeat(64),
        status: 'queued',
      },
      {
        articleId,
        scope: 'paragraph',
        paragraphId: paragraphIds[0],
        sourceHash: 'c'.repeat(64),
        status: 'ready',
        translatedTextZh: '这是原创测试译文。',
        readyAt: new Date(),
      },
    ]);

    const importId = crypto.randomUUID();
    await db.insert(articleImports).values({
      id: importId,
      userId: ownerId,
      sourceKind: 'computer',
      status: 'awaiting_upload',
      expiresAt: new Date(Date.now() + 600_000),
    });
    await db.insert(importAssets).values({
      articleImportId: importId,
      position: 0,
      mediaType: 'image/jpeg',
      byteSize: 1,
      sha256: 'd'.repeat(64),
      content: Buffer.from('x'),
    });
    await db.insert(computerUploadSessions).values({
      userId: ownerId,
      articleImportId: importId,
      codeHash: 'e'.repeat(64),
      status: 'awaiting_code',
      expiresAt: new Date(Date.now() + 600_000),
    });

    await expect(
      db.insert(importAssets).values({
        articleImportId: importId,
        position: 0,
        mediaType: 'image/jpeg',
        byteSize: 1,
        sha256: 'f'.repeat(64),
        content: Buffer.from('y'),
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(importedArticles).values({
        userId: ownerId,
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'Duplicate',
        wordCount: 20,
        contentHash,
        similarityFingerprint: 1n,
        importedAt: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(importedArticles).values({
        userId: otherId,
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'Other owner copy',
        wordCount: 20,
        contentHash,
        similarityFingerprint: 1n,
        importedAt: new Date(),
      }),
    ).resolves.toBeDefined();

    const insertedJobs = await db
      .insert(jobs)
      .values([
        {
          kind: 'article_import',
          resourceId: importId,
          status: 'queued',
          maxAttempts: 3,
          availableAt: new Date(),
          deadlineAt: new Date(Date.now() + 120_000),
        },
        {
          kind: 'article_translation',
          resourceId: crypto.randomUUID(),
          status: 'queued',
          maxAttempts: 3,
          availableAt: new Date(),
          deadlineAt: new Date(Date.now() + 120_000),
        },
      ])
      .returning({ kind: jobs.kind });
    expect(insertedJobs.map((row) => row.kind)).toEqual([
      'article_import',
      'article_translation',
    ]);
    expect(insertedJobs.every((row) => jobKinds.includes(row.kind))).toBe(true);
  });
}, 120_000);

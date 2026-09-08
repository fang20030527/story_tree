import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { ArticleImportDtoSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { articleImports, importAssets, jobs } from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import {
  claimNextJob,
  markSucceeded,
  rescheduleOrFail,
} from '../jobs/repository';
import { AppError } from '../../core/errors';
import { failArticleImport, handleArticleImport } from './handler';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});

const HTML = `<!doctype html><html><head><title>A safe synthetic report</title></head>
<body><article><p>Careful readers compare evidence before accepting a broad public claim.</p>
<p>They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.</p>
</article></body></html>`;

describe('article import worker', () => {
  it('turns a leased URL job into a normalized preview exactly once', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '66'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await app.inject({
          method: 'POST',
          url: '/v1/imports',
          headers: authHeaders(token, 'url-create-worker-01'),
          payload: {
            sourceKind: 'url',
            url: 'https://example.com/synthetic-report',
          },
        });
        const importId = ArticleImportDtoSchema.parse(created.json()).id;
        const job = await claimNextJob(db, 'url-worker', 60_000, [
          'article_import',
        ]);
        expect(job?.resourceId).toBe(importId);
        await handleArticleImport(
          {
            db,
            fetchMaxBytes: config.IMPORT_FETCH_MAX_BYTES,
            fetchTimeoutMs: config.IMPORT_FETCH_TIMEOUT_MS,
            fetchHtml: async () => ({
              finalUrl: 'https://example.com/synthetic-report',
              html: HTML,
            }),
          },
          job!,
          { signal: new AbortController().signal },
        );
        expect(await markSucceeded(db, job!.id, job!.lockedBy)).toBe(true);
        const [row] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, importId));
        expect(row).toMatchObject({
          status: 'preview_ready',
          attemptCount: 1,
          failureCode: null,
        });
        expect(row?.previewText).toContain('Careful readers compare evidence');
        expect(await db.select().from(importAssets)).toHaveLength(0);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('extracts a bounded local text asset and removes its source bytes', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '70'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const importId = crypto.randomUUID();
      const content = Buffer.from(
        [
          'Careful readers compare evidence before accepting a broad public claim.',
          'They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.',
        ].join('\n\n'),
      );
      await db.insert(articleImports).values({
        id: importId,
        userId: owner.userId,
        sourceKind: 'local_file',
        sourceUrl: null,
        assetManifestJson: [
          { position: 0, mediaType: 'text/plain', byteSize: content.byteLength },
        ],
        status: 'queued',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db.insert(importAssets).values({
        articleImportId: importId,
        position: 0,
        mediaType: 'text/plain',
        byteSize: content.byteLength,
        sha256: 'a'.repeat(64),
        content,
      });
      await db.insert(jobs).values({
        kind: 'article_import',
        resourceId: importId,
        status: 'queued',
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const job = await claimNextJob(db, 'local-document-worker', 60_000, [
        'article_import',
      ]);
      await handleArticleImport(
        { db, fetchMaxBytes: 100, fetchTimeoutMs: 100 },
        job!,
        { signal: new AbortController().signal },
      );
      expect(await markSucceeded(db, job!.id, job!.lockedBy)).toBe(true);
      const [preview] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, importId));
      expect(preview?.status).toBe('preview_ready');
      expect(preview?.previewText).toContain('Careful readers compare evidence');
      expect(await db.select().from(importAssets)).toHaveLength(0);
    });
  }, 120_000);

  it('returns retryable work to queued and requires an active lease', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '67'.repeat(32);
      const user = await registerAnonymous(db, token, true);
      const importId = crypto.randomUUID();
      await db.insert(articleImports).values({
        id: importId,
        userId: user.userId,
        sourceKind: 'url',
        sourceUrl: 'https://example.com/transient',
        status: 'queued',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db.insert(jobs).values({
        kind: 'article_import',
        resourceId: importId,
        status: 'queued',
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const job = await claimNextJob(db, 'retry-worker', 60_000, [
        'article_import',
      ]);
      const failure = new AppError(
        'IMPORT_FETCH_FAILED',
        '网页暂时无法读取',
        503,
        true,
      );
      await expect(
        handleArticleImport(
          {
            db,
            fetchMaxBytes: 100,
            fetchTimeoutMs: 100,
            fetchHtml: async () => Promise.reject(failure),
          },
          job!,
          { signal: new AbortController().signal },
        ),
      ).rejects.toBe(failure);
      const [queued] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, importId));
      expect(queued?.status).toBe('queued');
      expect(await rescheduleOrFail(db, job!, failure)).toBe('rescheduled');

      const second = await claimNextJob(db, 'lost-worker', 60_000, [
        'article_import',
      ]);
      expect(second).not.toBeNull();
      await db.update(jobs).set({ lockedBy: 'winner' }).where(eq(jobs.id, second!.id));
      await expect(
        handleArticleImport(
          {
            db,
            fetchMaxBytes: 100,
            fetchTimeoutMs: 100,
            fetchHtml: async () => ({ finalUrl: '', html: HTML }),
          },
          second!,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  }, 120_000);

  it('maps permanent failures and supports owner-only explicit retry', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '68'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const otherToken = '69'.repeat(32);
      await registerAnonymous(db, otherToken, true);
      const importId = crypto.randomUUID();
      await db.insert(articleImports).values({
        id: importId,
        userId: owner.userId,
        sourceKind: 'url',
        sourceUrl: 'https://example.com/exhausted',
        status: 'processing',
        attemptCount: 3,
        processingStartedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db.insert(jobs).values({
        kind: 'article_import',
        resourceId: importId,
        status: 'queued',
        attemptCount: 2,
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const job = await claimNextJob(db, 'final-worker', 60_000, [
        'article_import',
      ]);
      const failure = new AppError(
        'IMPORT_FETCH_FAILED',
        '网页暂时无法读取',
        503,
        true,
      );
      await failArticleImport(
        { db },
        job!,
        failure,
        { signal: new AbortController().signal },
      );
      await rescheduleOrFail(db, job!, failure);
      const app = buildApp({ config, db, logger: false });
      try {
        const hidden = await app.inject({
          method: 'POST',
          url: `/v1/imports/${importId}/retry`,
          headers: authHeaders(otherToken, 'url-retry-foreign-01'),
          payload: {},
        });
        expect(hidden.statusCode).toBe(404);
        const retried = await app.inject({
          method: 'POST',
          url: `/v1/imports/${importId}/retry`,
          headers: authHeaders(token, 'url-retry-owner-0001'),
          payload: {},
        });
        expect(retried.statusCode).toBe(202);
        expect(ArticleImportDtoSchema.parse(retried.json()).status).toBe(
          'queued',
        );
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});

function authHeaders(token: string, idempotencyKey: string) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': idempotencyKey,
  };
}

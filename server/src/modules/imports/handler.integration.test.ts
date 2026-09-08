import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

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
import type { OcrImage } from '../../infrastructure/ai/types';
import { failArticleImport, handleArticleImport } from './handler';
import type { ImportAssetInput } from './extractors/types';

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
      expect(
        await rescheduleOrFail(db, job!, failure, {
          now: new Date(Date.now() - 2_000),
          random: () => 0,
        }),
      ).toBe('rescheduled');

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

  it.each([1, 4, 5, 10])(
    'normalizes and OCRs %i ordered album images into one preview',
    async (count) => {
      await withTestDatabase(async ({ db }) => {
        const token = '71'.repeat(32);
        const owner = await registerAnonymous(db, token, true);
        const importId = crypto.randomUUID();
        const content = await syntheticJpeg();
        await db.insert(articleImports).values({
          id: importId,
          userId: owner.userId,
          sourceKind: 'album',
          sourceUrl: null,
          assetManifestJson: Array.from({ length: count }, (_, position) => ({
            position,
            mediaType: 'image/jpeg',
            byteSize: content.byteLength,
          })),
          status: 'queued',
          expiresAt: new Date(Date.now() + 60_000),
        });
        for (let position = 0; position < count; position += 1) {
          await db.insert(importAssets).values({
            articleImportId: importId,
            position,
            mediaType: 'application/octet-stream',
            byteSize: content.byteLength,
            sha256: `${position}`.padStart(64, '0'),
            content,
          });
        }
        await db.insert(jobs).values({
          kind: 'article_import',
          resourceId: importId,
          status: 'queued',
          deadlineAt: new Date(Date.now() + 120_000),
        });
        const job = await claimNextJob(db, `album-worker-${count}`, 60_000, [
          'article_import',
        ]);
        const captured: string[] = [];
        const extractArticleText = vi.fn(
          async (images: readonly OcrImage[], signal: AbortSignal) => {
            signal.throwIfAborted();
            for (const image of images) captured.push(image.mediaType);
            return {
              title: images[0]?.position === 0 ? 'Synthetic album article' : null,
              text: images
                .map(
                  ({ position }) =>
                    `Careful readers compare evidence on image ${position} before accepting broad public claims, preserve surrounding context, inspect remaining uncertainty, and revise measured conclusions whenever reliable facts change.`,
                )
                .join(' '),
            };
          },
        );
        const normalizedInputs: ImportAssetInput[] = [];
        await handleArticleImport(
          {
            db,
            fetchMaxBytes: 100,
            fetchTimeoutMs: 100,
            provider: { extractArticleText },
            normalizeImage: async (asset) => {
              normalizedInputs.push(asset);
              return {
                position: asset.position,
                mediaType: 'image/jpeg',
                base64: asset.content.toString('base64'),
              };
            },
          },
          job!,
          { signal: new AbortController().signal },
        );
        expect(normalizedInputs).toHaveLength(count);
        expect(normalizedInputs.map(({ position }) => position)).toEqual(
          Array.from({ length: count }, (_, position) => position),
        );
        for (const input of normalizedInputs) {
          expect(input.mediaType).toBe('image/jpeg');
        }
        expect(extractArticleText).toHaveBeenCalledTimes(
          Math.ceil(count / 4),
        );
        expect(captured.every((mediaType) => mediaType === 'image/jpeg')).toBe(
          true,
        );
        expect(await markSucceeded(db, job!.id, job!.lockedBy)).toBe(true);
        const [preview] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, importId));
        expect(preview?.status).toBe('preview_ready');
        expect(preview?.previewTitle).toBe('Synthetic album article');
        expect(preview?.previewText).toContain('image 0');
        expect(preview?.previewText).toContain(`image ${count - 1}`);
        expect(await db.select().from(importAssets)).toHaveLength(0);
      });
    },
    120_000,
  );

  it('routes a local image file through magic detection and OCR', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '72'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const importId = crypto.randomUUID();
      const content = await syntheticJpeg();
      await db.insert(articleImports).values({
        id: importId,
        userId: owner.userId,
        sourceKind: 'local_file',
        sourceUrl: null,
        assetManifestJson: [
          {
            position: 0,
            mediaType: 'application/octet-stream',
            byteSize: content.byteLength,
          },
        ],
        status: 'queued',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db.insert(importAssets).values({
        articleImportId: importId,
        position: 0,
        mediaType: 'application/octet-stream',
        byteSize: content.byteLength,
        sha256: 'b'.repeat(64),
        content,
      });
      await db.insert(jobs).values({
        kind: 'article_import',
        resourceId: importId,
        status: 'queued',
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const job = await claimNextJob(db, 'local-image-worker', 60_000, [
        'article_import',
      ]);
      const normalizeImage = vi.fn(async (asset: ImportAssetInput) => ({
        position: asset.position,
        mediaType: 'image/jpeg' as const,
        base64: asset.content.toString('base64'),
      }));
      const extractArticleText = vi.fn(async () => ({
        title: null,
        text: 'Careful readers compare evidence from local images before accepting broad public claims, preserve surrounding context, inspect remaining uncertainty, and revise measured conclusions whenever reliable facts change.',
      }));
      await handleArticleImport(
        {
          db,
          fetchMaxBytes: 100,
          fetchTimeoutMs: 100,
          provider: { extractArticleText },
          normalizeImage,
        },
        job!,
        { signal: new AbortController().signal },
      );
      expect(normalizeImage).toHaveBeenCalledOnce();
      expect(normalizeImage.mock.calls[0]?.[0]?.mediaType).toBe('image/jpeg');
      expect(extractArticleText).toHaveBeenCalledOnce();
      const [preview] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, importId));
      expect(preview?.status).toBe('preview_ready');
      expect(preview?.previewText).toContain('local images');
      expect(await db.select().from(importAssets)).toHaveLength(0);
    });
  }, 120_000);

  it('keeps album source assets when OCR is retryable', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '73'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const importId = crypto.randomUUID();
      const content = await syntheticJpeg();
      await db.insert(articleImports).values({
        id: importId,
        userId: owner.userId,
        sourceKind: 'album',
        sourceUrl: null,
        assetManifestJson: [
          { position: 0, mediaType: 'image/jpeg', byteSize: content.byteLength },
        ],
        status: 'queued',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db.insert(importAssets).values({
        articleImportId: importId,
        position: 0,
        mediaType: 'image/jpeg',
        byteSize: content.byteLength,
        sha256: 'c'.repeat(64),
        content,
      });
      await db.insert(jobs).values({
        kind: 'article_import',
        resourceId: importId,
        status: 'queued',
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const job = await claimNextJob(db, 'ocr-retry-worker', 60_000, [
        'article_import',
      ]);
      const extractArticleText = vi.fn(async () => {
        throw new AppError('AI_UNAVAILABLE', 'upstream timeout', 503, true);
      });
      await expect(
        handleArticleImport(
          {
            db,
            fetchMaxBytes: 100,
            fetchTimeoutMs: 100,
            provider: { extractArticleText },
            normalizeImage: async (asset) => ({
              position: asset.position,
              mediaType: 'image/jpeg',
              base64: asset.content.toString('base64'),
            }),
          },
          job!,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ code: 'IMPORT_OCR_FAILED', retryable: true });
      const [queued] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, importId));
      expect(queued?.status).toBe('queued');
      const remaining = await db
        .select()
        .from(importAssets)
        .where(eq(importAssets.articleImportId, importId));
      expect(remaining).toHaveLength(1);
    });
  }, 120_000);

  it('treats undecodable album images as terminal and deletes their assets', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '74'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const importId = crypto.randomUUID();
      const corrupt = Buffer.from('not-an-image');
      await db.insert(articleImports).values({
        id: importId,
        userId: owner.userId,
        sourceKind: 'album',
        sourceUrl: null,
        assetManifestJson: [
          { position: 0, mediaType: 'image/jpeg', byteSize: corrupt.byteLength },
        ],
        status: 'queued',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db.insert(importAssets).values({
        articleImportId: importId,
        position: 0,
        mediaType: 'image/jpeg',
        byteSize: corrupt.byteLength,
        sha256: 'd'.repeat(64),
        content: corrupt,
      });
      await db.insert(jobs).values({
        kind: 'article_import',
        resourceId: importId,
        status: 'queued',
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + 120_000),
      });
      const job = await claimNextJob(db, 'ocr-terminal-worker', 60_000, [
        'article_import',
      ]);
      const extractArticleText = vi.fn();
      await expect(
        handleArticleImport(
          {
            db,
            fetchMaxBytes: 100,
            fetchTimeoutMs: 100,
            provider: { extractArticleText },
          },
          job!,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({
        code: 'IMPORT_UNSUPPORTED_TYPE',
        retryable: false,
      });
      const failure = new AppError(
        'IMPORT_UNSUPPORTED_TYPE',
        '该内容类型不支持',
        422,
      );
      await failArticleImport(
        { db },
        job!,
        failure,
        { signal: new AbortController().signal },
      );
      const [failed] = await db
        .select()
        .from(articleImports)
        .where(eq(articleImports.id, importId));
      expect(failed?.status).toBe('failed');
      expect(failed?.failureCode).toBe('IMPORT_UNSUPPORTED_TYPE');
      expect(extractArticleText).not.toHaveBeenCalled();
      expect(await db.select().from(importAssets)).toHaveLength(0);
    });
  }, 120_000);
});

function authHeaders(token: string, idempotencyKey: string) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': idempotencyKey,
  };
}

async function syntheticJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 24,
      height: 12,
      channels: 3,
      background: '#234567',
    },
  })
    .jpeg()
    .toBuffer();
}

import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import {
  articleImports,
  articleParagraphs,
  computerUploadSessions,
  importedArticles,
  importAssets,
  jobs,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import {
  sweepImportCleanup,
  type ImportCleanupResult,
} from './cleanup';

const DAY_MS = 86_400_000;
const PREVIEW_TEXT = [
  'Careful readers compare evidence before accepting broad claims about a changing world.',
  'They preserve context, test uncertainty, and revise conclusions when reliable facts change.',
].join('\n\n');

describe('article import cleanup', () => {
  it('expires drafts and sessions, removes terminal bytes, and preserves active work', async () => {
    await withTestDatabase(async ({ db }) => {
      const now = new Date('2026-09-09T00:00:00.000Z');
      const old = new Date(now.getTime() - DAY_MS);
      const fresh = new Date(now.getTime() - DAY_MS + 1);
      const future = new Date(now.getTime() + 60_000);
      const owner = await registerAnonymous(db, '90'.repeat(32), true);
      const ids = Object.fromEntries(
        [
          'livePartial',
          'expiredAwaiting',
          'retryableAsset',
          'retryableUrl',
          'previewExpired',
          'sessionAwaiting',
          'sessionClaimed',
          'confirmed',
          'failed',
          'expired',
          'cancelled',
          'activeQueued',
          'activeProcessing',
          'orphanedQueued',
          'orphanedProcessing',
        ].map((name) => [name, crypto.randomUUID()]),
      ) as Record<string, string>;

      const articleId = crypto.randomUUID();
      await db.insert(importedArticles).values({
        id: articleId,
        userId: owner.userId,
        sourceKind: 'paste',
        sourceUrl: null,
        title: 'A retained synthetic article',
        wordCount: 22,
        contentHash: 'a'.repeat(64),
        similarityFingerprint: 1n,
        previousVersionId: null,
        importedAt: now,
      });
      await db.insert(articleParagraphs).values({
        articleId,
        position: 0,
        plainText: PREVIEW_TEXT,
      });

      await db.insert(articleImports).values([
        baseImport(ids.livePartial!, owner.userId, 'awaiting_upload', future),
        baseImport(ids.expiredAwaiting!, owner.userId, 'awaiting_upload', now),
        {
          ...baseImport(ids.retryableAsset!, owner.userId, 'retryable', future),
          failureCode: 'IMPORT_OCR_FAILED',
          failureMessagePublic: '图片文字识别暂时失败',
        },
        {
          ...baseImport(ids.retryableUrl!, owner.userId, 'retryable', now),
          sourceKind: 'url' as const,
          sourceUrl: 'https://example.com/synthetic',
          failureCode: 'IMPORT_FETCH_FAILED',
          failureMessagePublic: '网页暂时无法读取',
        },
        {
          ...baseImport(ids.previewExpired!, owner.userId, 'preview_ready', now),
          previewTitle: 'An expiring preview',
          previewText: PREVIEW_TEXT,
          wordCount: 22,
          contentHash: 'b'.repeat(64),
          similarityFingerprint: 2n,
          previewReadyAt: old,
        },
        baseImport(ids.sessionAwaiting!, owner.userId, 'awaiting_upload', future),
        baseImport(ids.sessionClaimed!, owner.userId, 'awaiting_upload', future),
        {
          ...baseImport(ids.confirmed!, owner.userId, 'confirmed', future),
          sourceKind: 'paste' as const,
          previewTitle: 'A retained synthetic article',
          previewText: PREVIEW_TEXT,
          wordCount: 22,
          contentHash: 'a'.repeat(64),
          similarityFingerprint: 1n,
          previewReadyAt: old,
          articleId,
          confirmedAt: old,
        },
        {
          ...baseImport(ids.failed!, owner.userId, 'failed', future),
          failureCode: 'IMPORT_PARSE_FAILED',
          failureMessagePublic: '文件无法解析',
        },
        baseImport(ids.expired!, owner.userId, 'expired', future),
        baseImport(ids.cancelled!, owner.userId, 'cancelled', future),
        baseImport(ids.activeQueued!, owner.userId, 'queued', now),
        {
          ...baseImport(ids.activeProcessing!, owner.userId, 'processing', now),
          processingStartedAt: old,
        },
        baseImport(ids.orphanedQueued!, owner.userId, 'queued', future),
        {
          ...baseImport(
            ids.orphanedProcessing!,
            owner.userId,
            'processing',
            future,
          ),
          processingStartedAt: old,
        },
      ]);

      const assetImports = [
        ids.livePartial!,
        ids.expiredAwaiting!,
        ids.retryableAsset!,
        ids.previewExpired!,
        ids.sessionAwaiting!,
        ids.sessionClaimed!,
        ids.confirmed!,
        ids.failed!,
        ids.expired!,
        ids.cancelled!,
        ids.activeQueued!,
        ids.activeProcessing!,
        ids.orphanedQueued!,
        ids.orphanedProcessing!,
      ];
      await db.insert(importAssets).values(
        assetImports.map((articleImportId, index) => ({
          articleImportId,
          position: 0,
          mediaType: 'text/plain',
          byteSize: 1,
          sha256: index.toString(16).padStart(64, '0'),
          content: Buffer.from('x'),
          createdAt:
            articleImportId === ids.livePartial ||
            articleImportId === ids.retryableAsset ||
            articleImportId === ids.activeQueued ||
            articleImportId === ids.activeProcessing
              ? old
              : fresh,
        })),
      );

      await db.insert(computerUploadSessions).values([
        {
          id: crypto.randomUUID(),
          userId: owner.userId,
          articleImportId: ids.sessionAwaiting!,
          codeHash: 'c'.repeat(64),
          status: 'awaiting_code',
          expiresAt: now,
        },
        {
          id: crypto.randomUUID(),
          userId: owner.userId,
          articleImportId: ids.sessionClaimed!,
          codeHash: 'd'.repeat(64),
          capabilityTokenHash: 'e'.repeat(64),
          status: 'claimed',
          claimedAt: old,
          expiresAt: now,
        },
      ]);

      await db.insert(jobs).values([
        {
          kind: 'article_import',
          resourceId: ids.activeQueued!,
          status: 'queued',
          deadlineAt: future,
        },
        {
          kind: 'article_import',
          resourceId: ids.activeProcessing!,
          status: 'running',
          lockedAt: old,
          leaseExpiresAt: future,
          lockedBy: 'active-cleanup-test-worker',
          deadlineAt: future,
        },
        {
          kind: 'article_import',
          resourceId: ids.orphanedQueued!,
          status: 'failed',
          deadlineAt: old,
          finishedAt: old,
          lastErrorCode: 'IMPORT_DEADLINE_EXCEEDED',
        },
        {
          kind: 'article_import',
          resourceId: ids.orphanedProcessing!,
          status: 'failed',
          deadlineAt: old,
          finishedAt: old,
          lastErrorCode: 'IMPORT_DEADLINE_EXCEEDED',
        },
      ]);

      const results = await Promise.all([
        sweepImportCleanup(db, { now, assetTtlMs: DAY_MS }),
        sweepImportCleanup(db, { now, assetTtlMs: DAY_MS }),
      ]);
      expect(sumResults(results)).toEqual({
        expiredImports: 6,
        expiredSessions: 2,
        deletedAssets: 12,
        failedOrphanedWork: 2,
      });

      const rows = await db.select().from(articleImports);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(ids.livePartial!)?.status).toBe('awaiting_upload');
      for (const id of [
        ids.expiredAwaiting!,
        ids.retryableAsset!,
        ids.retryableUrl!,
        ids.previewExpired!,
        ids.sessionAwaiting!,
        ids.sessionClaimed!,
      ]) {
        expect(byId.get(id)?.status).toBe('expired');
      }
      expect(byId.get(ids.retryableAsset!)).toMatchObject({
        failureCode: null,
        failureMessagePublic: null,
      });
      expect(byId.get(ids.previewExpired!)).toMatchObject({
        previewTitle: null,
        previewText: null,
        wordCount: null,
        contentHash: null,
        similarityFingerprint: null,
        previewReadyAt: null,
      });
      for (const id of [ids.orphanedQueued!, ids.orphanedProcessing!]) {
        expect(byId.get(id)).toMatchObject({
          status: 'failed',
          failureCode: 'IMPORT_DEADLINE_EXCEEDED',
          failureMessagePublic: '导入任务已超过处理时间',
          processingStartedAt: null,
        });
      }
      expect(byId.get(ids.activeQueued!)?.status).toBe('queued');
      expect(byId.get(ids.activeProcessing!)?.status).toBe('processing');
      expect(byId.get(ids.confirmed!)?.status).toBe('confirmed');
      expect(byId.get(ids.failed!)?.status).toBe('failed');
      expect(byId.get(ids.expired!)?.status).toBe('expired');
      expect(byId.get(ids.cancelled!)?.status).toBe('cancelled');

      const sessions = await db.select().from(computerUploadSessions);
      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session.status).toBe('expired');
        expect(session.capabilityTokenHash).toBeNull();
      }

      const remainingAssets = await db.select().from(importAssets);
      expect(
        remainingAssets.map((asset) => asset.articleImportId).sort(),
      ).toEqual([ids.activeProcessing!, ids.activeQueued!].sort());
      expect(await db.select().from(importedArticles)).toHaveLength(1);
      expect(
        await db
          .select()
          .from(articleParagraphs)
          .where(eq(articleParagraphs.articleId, articleId)),
      ).toHaveLength(1);
      expect(await db.select().from(jobs)).toHaveLength(4);

      expect(
        await sweepImportCleanup(db, { now, assetTtlMs: DAY_MS }),
      ).toEqual({
        expiredImports: 0,
        expiredSessions: 0,
        deletedAssets: 0,
        failedOrphanedWork: 0,
      });
    });
  }, 120_000);

  it('bounds each cleanup selector to at most one hundred rows', async () => {
    await withTestDatabase(async ({ db }) => {
      const now = new Date('2026-09-09T00:00:00.000Z');
      const owner = await registerAnonymous(db, '91'.repeat(32), true);
      const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
      await db.insert(articleImports).values(
        ids.map((id) => baseImport(id, owner.userId, 'expired', now)),
      );
      await db.insert(importAssets).values(
        ids.map((articleImportId, index) => ({
          articleImportId,
          position: 0,
          mediaType: 'text/plain',
          byteSize: 1,
          sha256: index.toString(16).padStart(64, '0'),
          content: Buffer.from('x'),
          createdAt: now,
        })),
      );

      const first = await sweepImportCleanup(db, {
        now,
        assetTtlMs: DAY_MS,
        batchSize: 1_000,
      });
      expect(first.deletedAssets).toBe(100);
      expect(
        await db
          .select({ id: importAssets.id })
          .from(importAssets)
          .where(inArray(importAssets.articleImportId, ids)),
      ).toHaveLength(1);

      const second = await sweepImportCleanup(db, {
        now,
        assetTtlMs: DAY_MS,
      });
      expect(second.deletedAssets).toBe(1);
    });
  }, 120_000);
});

function baseImport(
  id: string,
  userId: string,
  status: typeof articleImports.$inferInsert.status,
  expiresAt: Date,
): typeof articleImports.$inferInsert {
  return {
    id,
    userId,
    sourceKind: 'computer',
    sourceUrl: null,
    assetManifestJson: null,
    status,
    expiresAt,
  };
}

function sumResults(results: ImportCleanupResult[]): ImportCleanupResult {
  return results.reduce<ImportCleanupResult>(
    (sum, result) => ({
      expiredImports: sum.expiredImports + result.expiredImports,
      expiredSessions: sum.expiredSessions + result.expiredSessions,
      deletedAssets: sum.deletedAssets + result.deletedAssets,
      failedOrphanedWork:
        sum.failedOrphanedWork + result.failedOrphanedWork,
    }),
    {
      expiredImports: 0,
      expiredSessions: 0,
      deletedAssets: 0,
      failedOrphanedWork: 0,
    },
  );
}

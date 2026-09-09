import type { ArticleImportStatus } from '@context-reader/contracts';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  articleImports,
  computerUploadSessions,
  importAssets,
  jobs,
} from '../../db/schema';
import { assertImportTransition } from './state';

const MAX_BATCH_SIZE = 100;
const DEADLINE_FAILURE_MESSAGE = '导入任务已超过处理时间';

export interface ImportCleanupResult {
  expiredImports: number;
  expiredSessions: number;
  deletedAssets: number;
  failedOrphanedWork: number;
}

interface ImportCandidate extends Record<string, unknown> {
  id: string;
  status: ArticleImportStatus;
}

interface SessionCandidate extends Record<string, unknown> {
  sessionId: string;
  articleImportId: string;
  importStatus: ArticleImportStatus;
}

interface IdCandidate extends Record<string, unknown> {
  id: string;
}

export async function sweepImportCleanup(
  db: AppDatabase,
  input: {
    now: Date;
    assetTtlMs: number;
    batchSize?: number;
  },
): Promise<ImportCleanupResult> {
  const batchSize = normalizeBatchSize(input.batchSize);
  if (
    !Number.isInteger(input.assetTtlMs) ||
    input.assetTtlMs <= 0 ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new RangeError('cleanup time and assetTtlMs must be valid');
  }
  const assetCutoff = new Date(input.now.getTime() - input.assetTtlMs);

  return db.transaction(async (tx) => {
    const result: ImportCleanupResult = {
      expiredImports: 0,
      expiredSessions: 0,
      deletedAssets: 0,
      failedOrphanedWork: 0,
    };

    const expiredSessions = await selectExpiredSessions(
      tx,
      input.now,
      batchSize,
    );
    if (expiredSessions.length > 0) {
      const sessionIds = expiredSessions.map(({ sessionId }) => sessionId);
      const updatedSessions = await tx
        .update(computerUploadSessions)
        .set({ status: 'expired', capabilityTokenHash: null })
        .where(
          and(
            inArray(computerUploadSessions.id, sessionIds),
            sql`${computerUploadSessions.status} in ('awaiting_code', 'claimed')`,
          ),
        )
        .returning({ id: computerUploadSessions.id });
      result.expiredSessions += updatedSessions.length;

      const linkedImports = expiredSessions.filter(
        ({ importStatus }) => importStatus === 'awaiting_upload',
      );
      for (const candidate of linkedImports) {
        assertImportTransition(
          candidate.importStatus,
          'expired',
          'expired',
        );
      }
      const linkedImportIds = linkedImports.map(
        ({ articleImportId }) => articleImportId,
      );
      if (linkedImportIds.length > 0) {
        const updatedImports = await expireImports(
          tx,
          linkedImportIds,
          input.now,
          'awaiting_upload',
        );
        result.expiredImports += updatedImports.length;
        result.deletedAssets += await deleteAssetsForImports(
          tx,
          updatedImports,
        );
      }
    }

    const expiringImports = await selectExpiringImports(
      tx,
      input.now,
      assetCutoff,
      batchSize,
    );
    for (const candidate of expiringImports) {
      assertImportTransition(candidate.status, 'expired', 'expired');
    }
    if (expiringImports.length > 0) {
      const updatedImports = await expireImports(
        tx,
        expiringImports.map(({ id }) => id),
        input.now,
      );
      result.expiredImports += updatedImports.length;
      result.deletedAssets += await deleteAssetsForImports(tx, updatedImports);
    }

    const orphanedWork = await selectOrphanedWork(
      tx,
      input.now,
      batchSize,
    );
    for (const candidate of orphanedWork) {
      assertImportTransition(
        candidate.status,
        'failed',
        'permanent_failure',
      );
    }
    if (orphanedWork.length > 0) {
      const orphanedIds = orphanedWork.map(({ id }) => id);
      const failed = await tx
        .update(articleImports)
        .set({
          status: 'failed',
          failureCode: 'IMPORT_DEADLINE_EXCEEDED',
          failureMessagePublic: DEADLINE_FAILURE_MESSAGE,
          processingStartedAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            inArray(articleImports.id, orphanedIds),
            sql`${articleImports.status} in ('queued', 'processing')`,
          ),
        )
        .returning({ id: articleImports.id });
      const failedIds = failed.map(({ id }) => id);
      result.failedOrphanedWork += failedIds.length;
      result.deletedAssets += await deleteAssetsForImports(tx, failedIds);
    }

    const terminalAssetIds = await selectTerminalAssetIds(tx, batchSize);
    result.deletedAssets += await deleteAssetsById(tx, terminalAssetIds);

    const stalePartialAssetIds = await selectStalePartialAssetIds(
      tx,
      input.now,
      assetCutoff,
      batchSize,
    );
    result.deletedAssets += await deleteAssetsById(
      tx,
      stalePartialAssetIds,
    );

    return result;
  });
}

function normalizeBatchSize(batchSize: number | undefined): number {
  const requested = batchSize ?? MAX_BATCH_SIZE;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new RangeError('batchSize must be a positive integer');
  }
  return Math.min(requested, MAX_BATCH_SIZE);
}

async function selectExpiredSessions(
  tx: AppTransaction,
  now: Date,
  batchSize: number,
): Promise<SessionCandidate[]> {
  const result = await tx.execute<SessionCandidate>(sql`
    with candidate as (
      select
        ${computerUploadSessions.id} as "sessionId",
        ${computerUploadSessions.articleImportId} as "articleImportId",
        ${articleImports.status} as "importStatus"
      from ${computerUploadSessions}
      inner join ${articleImports}
        on ${articleImports.id} = ${computerUploadSessions.articleImportId}
      where ${computerUploadSessions.status} in ('awaiting_code', 'claimed')
        and ${computerUploadSessions.expiresAt} <= ${now}
      order by ${computerUploadSessions.expiresAt} asc,
        ${computerUploadSessions.createdAt} asc,
        ${computerUploadSessions.id} asc
      for update of ${computerUploadSessions}, ${articleImports} skip locked
      limit ${batchSize}
    )
    select "sessionId", "articleImportId", "importStatus"
    from candidate
  `);
  return result.rows;
}

async function selectExpiringImports(
  tx: AppTransaction,
  now: Date,
  assetCutoff: Date,
  batchSize: number,
): Promise<ImportCandidate[]> {
  const condition = sql`(
    ${articleImports.status} in ('awaiting_upload', 'retryable', 'preview_ready')
      and ${articleImports.expiresAt} <= ${now}
    ) or (
      ${articleImports.status} = 'retryable'
      and exists (
        select 1
        from ${importAssets}
        where ${importAssets.articleImportId} = ${articleImports.id}
          and ${importAssets.createdAt} <= ${assetCutoff}
      )
    )`;
  return selectImportCandidates(tx, condition, batchSize);
}

async function selectOrphanedWork(
  tx: AppTransaction,
  now: Date,
  batchSize: number,
): Promise<ImportCandidate[]> {
  const condition = sql`${articleImports.status} in ('queued', 'processing')
    and exists (
      select 1
      from ${jobs}
      where ${jobs.kind} = 'article_import'
        and ${jobs.resourceId} = ${articleImports.id}
        and ${jobs.deadlineAt} <= ${now}
    )
    and not exists (
      select 1
      from ${jobs}
      where ${jobs.kind} = 'article_import'
        and ${jobs.resourceId} = ${articleImports.id}
        and ${jobs.status} in ('queued', 'running')
        and ${jobs.deadlineAt} > ${now}
    )`;
  return selectImportCandidates(tx, condition, batchSize);
}

async function selectImportCandidates(
  tx: AppTransaction,
  condition: SQL,
  batchSize: number,
): Promise<ImportCandidate[]> {
  const result = await tx.execute<ImportCandidate>(sql`
    with candidate as (
      select ${articleImports.id} as "id", ${articleImports.status} as "status"
      from ${articleImports}
      where ${condition}
      order by ${articleImports.expiresAt} asc,
        ${articleImports.createdAt} asc,
        ${articleImports.id} asc
      for update of ${articleImports} skip locked
      limit ${batchSize}
    )
    select "id", "status"
    from candidate
  `);
  return result.rows;
}

async function selectTerminalAssetIds(
  tx: AppTransaction,
  batchSize: number,
): Promise<string[]> {
  const result = await tx.execute<IdCandidate>(sql`
    with candidate as (
      select ${importAssets.id} as "id"
      from ${importAssets}
      inner join ${articleImports}
        on ${articleImports.id} = ${importAssets.articleImportId}
      where ${articleImports.status} in ('confirmed', 'failed', 'expired', 'cancelled')
      order by ${importAssets.createdAt} asc, ${importAssets.id} asc
      for update of ${importAssets} skip locked
      limit ${batchSize}
    )
    select "id"
    from candidate
  `);
  return result.rows.map(({ id }) => id);
}

async function selectStalePartialAssetIds(
  tx: AppTransaction,
  now: Date,
  assetCutoff: Date,
  batchSize: number,
): Promise<string[]> {
  const result = await tx.execute<IdCandidate>(sql`
    with candidate as (
      select ${importAssets.id} as "id"
      from ${importAssets}
      inner join ${articleImports}
        on ${articleImports.id} = ${importAssets.articleImportId}
      where ${articleImports.status} = 'awaiting_upload'
        and ${articleImports.expiresAt} > ${now}
        and ${importAssets.createdAt} <= ${assetCutoff}
      order by ${importAssets.createdAt} asc, ${importAssets.id} asc
      for update of ${importAssets} skip locked
      limit ${batchSize}
    )
    select "id"
    from candidate
  `);
  return result.rows.map(({ id }) => id);
}

async function expireImports(
  tx: AppTransaction,
  importIds: string[],
  now: Date,
  expectedStatus?: ArticleImportStatus,
): Promise<string[]> {
  if (importIds.length === 0) return [];
  const statusCondition = expectedStatus
    ? eq(articleImports.status, expectedStatus)
    : sql`${articleImports.status} in ('awaiting_upload', 'retryable', 'preview_ready')`;
  const updated = await tx
    .update(articleImports)
    .set({
      status: 'expired',
      previewTitle: null,
      previewText: null,
      wordCount: null,
      contentHash: null,
      similarityFingerprint: null,
      failureCode: null,
      failureMessagePublic: null,
      processingStartedAt: null,
      previewReadyAt: null,
      articleId: null,
      confirmedAt: null,
      updatedAt: now,
    })
    .where(and(inArray(articleImports.id, importIds), statusCondition))
    .returning({ id: articleImports.id });
  return updated.map(({ id }) => id);
}

async function deleteAssetsForImports(
  tx: AppTransaction,
  importIds: string[],
): Promise<number> {
  if (importIds.length === 0) return 0;
  const deleted = await tx
    .delete(importAssets)
    .where(inArray(importAssets.articleImportId, importIds))
    .returning({ id: importAssets.id });
  return deleted.length;
}

async function deleteAssetsById(
  tx: AppTransaction,
  assetIds: string[],
): Promise<number> {
  if (assetIds.length === 0) return 0;
  const deleted = await tx
    .delete(importAssets)
    .where(inArray(importAssets.id, assetIds))
    .returning({ id: importAssets.id });
  return deleted.length;
}

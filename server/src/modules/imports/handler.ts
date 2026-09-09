import { and, eq, sql } from 'drizzle-orm';

import { AppError, type ErrorCode } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { articleImports, importAssets, jobs } from '../../db/schema';
import type { AiProvider, OcrImage } from '../../infrastructure/ai/types';
import type { ClaimedJob } from '../jobs/types';
import { shouldRetry } from '../jobs/retry';
import { normalizeImportContent, type NormalizedImportContent } from './content';
import {
  detectImportFile,
  extractDocumentAsset,
} from './extractors/document';
import { extractReadableHtml } from './extractors/html';
import { normalizeImageAsset } from './extractors/image';
import { extractOrderedImageText } from './extractors/ocr';
import { safeFetchHtml } from './extractors/safe-fetch';
import type { ExtractedArticle, ImportAssetInput } from './extractors/types';
import type { ArticleImportRow } from './repository';
import { assertImportTransition } from './state';

export interface ArticleImportHandlerDependencies {
  db: AppDatabase;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  fetchHtml?: typeof safeFetchHtml;
  extractDocument?: typeof extractDocumentAsset;
  provider?: Pick<AiProvider, 'extractArticleText'>;
  normalizeImage?: typeof normalizeImageAsset;
  extractImages?: typeof extractOrderedImageText;
}

export async function handleArticleImport(
  dependencies: ArticleImportHandlerDependencies,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void> {
  const current = await moveImportToProcessing(
    dependencies.db,
    job,
    context.signal,
  );
  try {
    assertWithinDeadline(job, context.signal);
    const extracted = await extractImportSource(
      dependencies,
      current,
      context.signal,
    );
    const normalized = normalizeImportContent(extracted);
    assertWithinDeadline(job, context.signal);
    await persistImportPreview(
      dependencies.db,
      job,
      normalized,
      context.signal,
    );
  } catch (error) {
    if (context.signal.aborted) throw error;
    if (error instanceof AppError && error.retryable && shouldRetry(job)) {
      await returnImportToQueue(dependencies.db, job, context.signal);
    }
    throw error;
  }
}

export async function failArticleImport(
  dependencies: Pick<ArticleImportHandlerDependencies, 'db'>,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  context.signal.throwIfAborted();
  await dependencies.db.transaction(async (tx) => {
    await requireActiveImportLease(tx, job);
    const current = await lockImport(tx, job.resourceId);
    if (
      current.status === 'retryable' ||
      current.status === 'failed' ||
      current.status === 'cancelled' ||
      current.status === 'expired' ||
      current.status === 'confirmed'
    ) {
      return;
    }

    const deadline =
      job.expired ||
      error.code === 'GENERATION_DEADLINE_EXCEEDED' ||
      Date.now() >= job.deadlineAt.getTime();
    const retryable = error.retryable && !deadline;
    const status = retryable ? 'retryable' : 'failed';
    assertImportTransition(
      current.status,
      status,
      retryable ? 'extraction_retryable' : 'permanent_failure',
    );
    const failure = publicImportFailure(error, deadline);
    const [updated] = await tx
      .update(articleImports)
      .set({
        status,
        previewTitle: null,
        previewText: null,
        wordCount: null,
        contentHash: null,
        similarityFingerprint: null,
        failureCode: failure.code,
        failureMessagePublic: failure.message,
        previewReadyAt: null,
        updatedAt: new Date(),
      })
      .where(eq(articleImports.id, current.id))
      .returning({ id: articleImports.id });
    if (!updated) throw stateConflict();
    if (!retryable) {
      await tx
        .delete(importAssets)
        .where(eq(importAssets.articleImportId, current.id));
    }
  });
}

async function moveImportToProcessing(
  db: AppDatabase,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<ArticleImportRow> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    await requireActiveImportLease(tx, job);
    const current = await lockImport(tx, job.resourceId);
    if (current.status !== 'queued' && current.status !== 'processing') {
      throw stateConflict();
    }
    if (current.status === 'queued') {
      assertImportTransition('queued', 'processing', 'worker_claimed');
    }
    const now = new Date();
    const [processing] = await tx
      .update(articleImports)
      .set({
        status: 'processing',
        attemptCount: current.attemptCount + 1,
        processingStartedAt: now,
        failureCode: null,
        failureMessagePublic: null,
        updatedAt: now,
      })
      .where(eq(articleImports.id, current.id))
      .returning();
    if (!processing) throw stateConflict();
    return processing;
  });
}

async function persistImportPreview(
  db: AppDatabase,
  job: ClaimedJob,
  normalized: NormalizedImportContent,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await db.transaction(async (tx) => {
    await requireActiveImportLease(tx, job);
    const current = await lockImport(tx, job.resourceId);
    if (current.status !== 'processing') throw stateConflict();
    assertImportTransition('processing', 'preview_ready', 'preview_created');
    const now = new Date();
    const [updated] = await tx
      .update(articleImports)
      .set({
        status: 'preview_ready',
        previewTitle: normalized.title,
        previewText: normalized.text,
        wordCount: normalized.wordCount,
        contentHash: normalized.contentHash,
        similarityFingerprint: normalized.similarityFingerprint,
        failureCode: null,
        failureMessagePublic: null,
        previewReadyAt: now,
        updatedAt: now,
      })
      .where(eq(articleImports.id, current.id))
      .returning({ id: articleImports.id });
    if (!updated) throw stateConflict();
    await tx
      .delete(importAssets)
      .where(eq(importAssets.articleImportId, current.id));
  });
}

async function returnImportToQueue(
  db: AppDatabase,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await db.transaction(async (tx) => {
    await requireActiveImportLease(tx, job);
    const current = await lockImport(tx, job.resourceId);
    if (current.status !== 'processing') throw stateConflict();
    assertImportTransition('processing', 'queued', 'automatic_retry');
    const [updated] = await tx
      .update(articleImports)
      .set({
        status: 'queued',
        processingStartedAt: null,
        failureCode: null,
        failureMessagePublic: null,
        updatedAt: new Date(),
      })
      .where(eq(articleImports.id, current.id))
      .returning({ id: articleImports.id });
    if (!updated) throw stateConflict();
  });
}

async function requireActiveImportLease(
  tx: AppTransaction,
  job: ClaimedJob,
): Promise<void> {
  const [lease] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.kind, 'article_import'),
        eq(jobs.resourceId, job.resourceId),
        eq(jobs.status, 'running'),
        eq(jobs.lockedBy, job.lockedBy),
        sql`${jobs.leaseExpiresAt} > now()`,
      ),
    )
    .for('update')
    .limit(1);
  if (!lease) throw new DOMException('Job lease lost', 'AbortError');
}

async function lockImport(
  tx: AppTransaction,
  importId: string,
): Promise<ArticleImportRow> {
  const [row] = await tx
    .select()
    .from(articleImports)
    .where(eq(articleImports.id, importId))
    .for('update')
    .limit(1);
  if (!row) {
    throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  }
  return row;
}

function assertWithinDeadline(job: ClaimedJob, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= job.deadlineAt.getTime()) {
    throw new AppError(
      'GENERATION_DEADLINE_EXCEEDED',
      '导入任务已超过截止时间',
      504,
    );
  }
}

function publicImportFailure(
  error: AppError,
  deadline: boolean,
): { code: ErrorCode; message: string } {
  if (deadline) {
    return {
      code: 'IMPORT_DEADLINE_EXCEEDED',
      message: '导入任务已超过处理时间',
    };
  }
  const safeMessages: Partial<Record<ErrorCode, string>> = {
    IMPORT_FETCH_BLOCKED: '该网络地址不允许导入',
    IMPORT_FETCH_FAILED: '网页暂时无法读取',
    IMPORT_UNSUPPORTED_TYPE: '该内容类型不支持',
    IMPORT_PARSE_FAILED: '未能提取可导入的正文',
    IMPORT_OCR_FAILED: '图片文字暂时无法识别',
    IMPORT_CONTENT_INVALID: '导入内容无效',
    IMPORT_NOT_ENGLISH: '只能导入英文文章',
    IMPORT_TOO_LARGE: '导入内容过大',
  };
  const code = error.code in safeMessages ? error.code : 'IMPORT_PARSE_FAILED';
  return { code, message: safeMessages[code] ?? '导入暂时无法完成' };
}

async function extractImportSource(
  dependencies: ArticleImportHandlerDependencies,
  current: ArticleImportRow,
  signal: AbortSignal,
): Promise<ExtractedArticle> {
  if (current.sourceKind === 'url' && current.sourceUrl) {
    const fetched = await (dependencies.fetchHtml ?? safeFetchHtml)(
      current.sourceUrl,
      {
        maxBytes: dependencies.fetchMaxBytes,
        timeoutMs: dependencies.fetchTimeoutMs,
        signal,
      },
    );
    signal.throwIfAborted();
    return extractReadableHtml(fetched.html, fetched.finalUrl);
  }
  if (
    current.sourceKind === 'local_file' ||
    current.sourceKind === 'computer'
  ) {
    const manifest = await loadImportAssetManifest(dependencies.db, current.id);
    if (manifest.length !== 1 || manifest[0]?.position !== 0) {
      throw new AppError('IMPORT_CONTENT_INVALID', '导入文件不完整', 422);
    }
    const asset = await loadImportAssetContent(
      dependencies.db,
      current.id,
      0,
    );
    const detected = await detectImportFile(
      asset.content,
      asset.mediaType,
    );
    if (detected.kind === 'image') {
      return extractImageAssets(
        dependencies,
        current.id,
        [0],
        signal,
      );
    }
    return (dependencies.extractDocument ?? extractDocumentAsset)(asset);
  }
  if (current.sourceKind === 'album') {
    const manifest = await loadImportAssetManifest(dependencies.db, current.id);
    if (
      manifest.length < 1 ||
      manifest.length > 10 ||
      manifest.some((asset, index) => asset.position !== index)
    ) {
      throw new AppError('IMPORT_CONTENT_INVALID', '图片顺序无效', 422);
    }
    return extractImageAssets(
      dependencies,
      current.id,
      manifest.map(({ position }) => position),
      signal,
    );
  }
  throw new AppError('IMPORT_UNSUPPORTED_TYPE', '该导入来源暂不支持处理', 422);
}

async function extractImageAssets(
  dependencies: ArticleImportHandlerDependencies,
  importId: string,
  positions: readonly number[],
  signal: AbortSignal,
): Promise<ExtractedArticle> {
  const provider = dependencies.provider;
  if (!provider) {
    throw new AppError(
      'IMPORT_OCR_FAILED',
      '图片文字暂时无法识别',
      503,
      true,
    );
  }
  const normalize = dependencies.normalizeImage ?? normalizeImageAsset;
  const extract = dependencies.extractImages ?? extractOrderedImageText;
  const normalized: OcrImage[] = [];
  for (const position of positions) {
    signal.throwIfAborted();
    const asset = await loadImportAssetContent(
      dependencies.db,
      importId,
      position,
    );
    const detected = await detectImportFile(asset.content, asset.mediaType);
    if (detected.kind !== 'image') {
      throw new AppError(
        'IMPORT_UNSUPPORTED_TYPE',
        '该内容类型不支持',
        422,
      );
    }
    normalized.push(await normalize({ ...asset, mediaType: detected.mediaType }));
  }
  return extract(normalized, provider, signal);
}

async function loadImportAssetManifest(
  db: AppDatabase,
  importId: string,
): Promise<Array<{ position: number; mediaType: string }>> {
  return db
    .select({
      position: importAssets.position,
      mediaType: importAssets.mediaType,
    })
    .from(importAssets)
    .where(eq(importAssets.articleImportId, importId))
    .orderBy(importAssets.position);
}

async function loadImportAssetContent(
  db: AppDatabase,
  importId: string,
  position: number,
): Promise<ImportAssetInput> {
  const [asset] = await db
    .select({
      position: importAssets.position,
      mediaType: importAssets.mediaType,
      content: importAssets.content,
    })
    .from(importAssets)
    .where(
      and(
        eq(importAssets.articleImportId, importId),
        eq(importAssets.position, position),
      ),
    )
    .limit(1);
  if (!asset) {
    throw new AppError('IMPORT_CONTENT_INVALID', '导入文件不完整', 422);
  }
  return asset;
}

function stateConflict(): AppError {
  return new AppError('STATE_CONFLICT', '导入状态已变更', 409);
}

import { AppError } from '../../../../server/src/core/errors';
import { extractHtmlOnCpuBoundary, normalizeImportContentOnCpuBoundary } from '../cpu/client';
import { extractOrderedImageText } from '../../../../server/src/modules/imports/extractors/ocr';
import { evolinkProvider } from '../ai/provider';
import {
  detectImportFile,
  extractDocumentAsset,
  ImportConversionError,
  normalizeImageAsset,
  type ExtractedArticle,
  type OcrImage,
} from '../imports/convert';
import {
  getImportAsset,
  ImportStorageError,
  deleteImportAsset,
} from '../imports/storage';
import { safeFetchHtmlOnCloudflare } from '../imports/safe-fetch';
import type { ApiEnv } from '../env';
import { shouldRetry, type ClaimedJob } from './repository';

// The handler is implemented, but producers and Queue remain gated until the
// complete article-import route set and isolated D1 integration are verified.
export const ARTICLE_IMPORT_HANDLER_AVAILABLE = true;
const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const FETCH_MAX_BYTES = 5_242_880;
const FETCH_TIMEOUT_MS = 15_000;

type ImportStatus = 'queued' | 'processing' | 'preview_ready' | 'retryable' |
  'failed' | 'confirmed' | 'cancelled' | 'expired';
interface ImportJobRow {
  source_kind: 'url' | 'local_file' | 'computer' | 'album' | 'paste';
  source_url: string | null;
  status: ImportStatus;
}

interface AssetPositionRow {
  position: number;
}

function invalidAssets(message: string): AppError {
  return new AppError('IMPORT_CONTENT_INVALID', message, 422);
}

function asAppError(error: unknown): unknown {
  if (error instanceof ImportConversionError || error instanceof ImportStorageError) {
    return new AppError(error.code, error.message, error.statusCode, error.retryable);
  }
  return error;
}

async function assetPositions(env: ApiEnv, importId: string): Promise<number[]> {
  const rows = await env.DB.prepare(`
    SELECT position FROM import_assets
    WHERE article_import_id = ? ORDER BY position
  `).bind(importId).all<AssetPositionRow>();
  return rows.results.map(({ position }) => position);
}

async function extractImages(
  env: ApiEnv,
  importId: string,
  positions: readonly number[],
  signal: AbortSignal,
): Promise<ExtractedArticle> {
  if (!env.EVOLINK_API_KEY) {
    throw new AppError('IMPORT_OCR_FAILED', '图片文字暂时无法识别', 503, true);
  }
  const images: OcrImage[] = [];
  for (const position of positions) {
    signal.throwIfAborted();
    const asset = await getImportAsset(env, importId, position);
    const detected = await detectImportFile(asset.content, asset.mediaType);
    if (detected.kind !== 'image') {
      throw new AppError('IMPORT_UNSUPPORTED_TYPE', '该内容类型不支持', 422);
    }
    images.push(await normalizeImageAsset(asset, { IMAGES: env.IMAGES }));
  }
  signal.throwIfAborted();
  return extractOrderedImageText(images, evolinkProvider(env), signal);
}

/**
 * Staged Worker-safe extraction for uploaded sources. R2 bytes are verified
 * against D1 metadata by getImportAsset, and document/image conversion is
 * delegated to Cloudflare bindings.
 */
export async function extractUploadedImportSource(
  env: ApiEnv,
  importId: string,
  sourceKind: 'local_file' | 'computer' | 'album',
  signal: AbortSignal,
): Promise<ExtractedArticle> {
  try {
    signal.throwIfAborted();
    const positions = await assetPositions(env, importId);
    if (sourceKind === 'album') {
      if (positions.length < 1 || positions.length > 10 ||
          positions.some((position, index) => position !== index)) {
        throw invalidAssets('图片顺序无效');
      }
      return await extractImages(env, importId, positions, signal);
    }
    if (positions.length !== 1 || positions[0] !== 0) {
      throw invalidAssets('导入文件不完整');
    }
    const asset = await getImportAsset(env, importId, 0);
    const detected = await detectImportFile(asset.content, asset.mediaType);
    signal.throwIfAborted();
    return detected.kind === 'image'
      ? await extractImages(env, importId, [0], signal)
      : await extractDocumentAsset(asset, { AI: env.AI });
  } catch (error) {
    throw asAppError(error);
  }
}

function activeLeaseSql(): string {
  return `EXISTS (SELECT 1 FROM jobs AS job WHERE job.id = ? AND
    job.kind = 'article_import' AND job.resource_id = article_imports.id AND
    job.status = 'running' AND job.locked_by = ? AND job.lease_expires_at > ${DB_NOW})`;
}

function assertDeadline(job: ClaimedJob, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= job.deadlineAt.getTime()) {
    throw new AppError('GENERATION_DEADLINE_EXCEEDED', '导入任务已超过处理时间', 504);
  }
}

function stateConflict(): AppError {
  return new AppError('STATE_CONFLICT', '导入状态已变更', 409);
}

async function importRow(env: ApiEnv, importId: string): Promise<ImportJobRow> {
  const row = await env.DB.prepare(
    'SELECT source_kind, source_url, status FROM article_imports WHERE id = ? LIMIT 1',
  ).bind(importId).first<ImportJobRow>();
  if (!row) throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  return row;
}

async function moveToProcessing(env: ApiEnv, job: ClaimedJob, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const row = await env.DB.prepare(`
    UPDATE article_imports SET status = 'processing', attempt_count = attempt_count + 1,
      processing_started_at = ${DB_NOW}, failure_code = NULL,
      failure_message_public = NULL, updated_at = ${DB_NOW}
    WHERE id = ? AND status IN ('queued', 'processing') AND ${activeLeaseSql()}
    RETURNING id
  `).bind(job.resourceId, job.id, job.lockedBy).first<{ id: string }>();
  if (row) return true;
  const current = await importRow(env, job.resourceId);
  if (current.status === 'preview_ready' || current.status === 'confirmed') return false;
  throw stateConflict();
}

async function persistPreview(
  env: ApiEnv,
  job: ClaimedJob,
  preview: Awaited<ReturnType<typeof normalizeImportContentOnCpuBoundary>>,
  signal: AbortSignal,
): Promise<void> {
  assertDeadline(job, signal);
  const row = await env.DB.prepare(`
    UPDATE article_imports SET status = 'preview_ready', preview_title = ?,
      preview_text = ?, word_count = ?, content_hash = ?, similarity_fingerprint = ?,
      failure_code = NULL, failure_message_public = NULL,
      preview_ready_at = ${DB_NOW}, updated_at = ${DB_NOW}
    WHERE id = ? AND status = 'processing' AND ${activeLeaseSql()}
    RETURNING id
  `).bind(preview.title, preview.text, preview.wordCount, preview.contentHash,
    preview.similarityFingerprint.toString(), job.resourceId, job.id, job.lockedBy)
    .first<{ id: string }>();
  if (!row) throw stateConflict();
}

async function returnToQueue(env: ApiEnv, job: ClaimedJob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const row = await env.DB.prepare(`
    UPDATE article_imports SET status = 'queued', processing_started_at = NULL,
      failure_code = NULL, failure_message_public = NULL, updated_at = ${DB_NOW}
    WHERE id = ? AND status = 'processing' AND ${activeLeaseSql()}
    RETURNING id
  `).bind(job.resourceId, job.id, job.lockedBy).first<{ id: string }>();
  if (!row) throw stateConflict();
}

function publicFailure(error: AppError, expired: boolean): { code: string; message: string } {
  if (expired) return { code: 'IMPORT_DEADLINE_EXCEEDED', message: '导入任务已超过处理时间' };
  const messages: Record<string, string> = {
    IMPORT_FETCH_BLOCKED: '该网络地址不允许导入',
    IMPORT_FETCH_FAILED: '网页暂时无法读取',
    IMPORT_UNSUPPORTED_TYPE: '该内容类型不支持',
    IMPORT_PARSE_FAILED: '未能提取可导入的正文',
    IMPORT_SOURCE_REQUIRES_ACCESS: '该分享链接无法直接读取正文，请复制英文正文或截图导入',
    IMPORT_OCR_FAILED: '图片文字暂时无法识别',
    IMPORT_CONTENT_INVALID: '导入内容无效',
    IMPORT_NOT_ENGLISH: '只能导入英文文章',
    IMPORT_TOO_LARGE: '导入内容过大',
  };
  return { code: messages[error.code] ? error.code : 'IMPORT_PARSE_FAILED',
    message: messages[error.code] ?? '导入暂时无法完成' };
}

/** The resource update is lease guarded; R2 cleanup is safe to retry separately. */
export async function handleArticleImport(
  env: ApiEnv,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void> {
  if (job.kind !== 'article_import') throw stateConflict();
  if (!(await moveToProcessing(env, job, context.signal))) return;
  try {
    assertDeadline(job, context.signal);
    const current = await importRow(env, job.resourceId);
    const preview = current.source_kind === 'url' && current.source_url
      ? await (async () => {
        const page = await safeFetchHtmlOnCloudflare(current.source_url!, {
          maxBytes: FETCH_MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS, signal: context.signal,
        });
        return extractHtmlOnCpuBoundary(env, page.html, page.finalUrl);
      })()
      : current.source_kind === 'album' || current.source_kind === 'local_file' ||
          current.source_kind === 'computer'
        ? await normalizeImportContentOnCpuBoundary(env,
          await extractUploadedImportSource(env, job.resourceId, current.source_kind, context.signal))
        : (() => { throw stateConflict(); })();
    await persistPreview(env, job, preview, context.signal);
    const positions = await assetPositions(env, job.resourceId);
    for (const position of positions) {
      // Preview is already durable. A failed R2 delete is recovered by Cron.
      await deleteImportAsset(env, job.resourceId, position).catch(() => undefined);
    }
  } catch (error) {
    if (context.signal.aborted) throw error;
    const appError = asAppError(error);
    if (appError instanceof AppError && appError.retryable && shouldRetry(job)) {
      await returnToQueue(env, job, context.signal);
    }
    throw appError;
  }
}

export async function failArticleImport(
  env: ApiEnv,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  context.signal.throwIfAborted();
  const current = await importRow(env, job.resourceId);
  if (['preview_ready', 'confirmed', 'retryable', 'failed', 'cancelled', 'expired']
    .includes(current.status)) return;
  const expired = job.expired || error.code === 'GENERATION_DEADLINE_EXCEEDED' ||
    Date.now() >= job.deadlineAt.getTime();
  const status = error.retryable && !expired ? 'retryable' : 'failed';
  const publicError = publicFailure(error, expired);
  const row = await env.DB.prepare(`
    UPDATE article_imports SET status = ?, preview_title = NULL, preview_text = NULL,
      word_count = NULL, content_hash = NULL, similarity_fingerprint = NULL,
      preview_ready_at = NULL, failure_code = ?, failure_message_public = ?,
      processing_started_at = NULL, updated_at = ${DB_NOW}
    WHERE id = ? AND status IN ('queued', 'processing') AND ${activeLeaseSql()}
    RETURNING id
  `).bind(status, publicError.code, publicError.message,
    job.resourceId, job.id, job.lockedBy).first<{ id: string }>();
  if (!row) throw stateConflict();
  if (status === 'failed') {
    const positions = await assetPositions(env, job.resourceId);
    for (const position of positions) {
      await deleteImportAsset(env, job.resourceId, position).catch(() => undefined);
    }
  }
}

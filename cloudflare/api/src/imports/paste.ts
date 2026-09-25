import { createHash } from 'node:crypto';

import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { normalizePastedContentOnCpuBoundary } from '../cpu/client';
import type { ApiEnv } from '../env';
import { handleImportReadRoute } from './read';

const MAX_TEXT_BYTES = 131_072;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

interface ImportRow {
  id: string;
  source_kind: string;
  status: string;
}

interface IdempotencyRow {
  request_hash: string;
  resource_id: string;
}

function databaseUnavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
}

function parseImportId(raw: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(value).success) {
    throw new AppError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }
  return value;
}

function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (key === null || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return key;
}

function assertPlainText(value: string | null): void {
  const essence = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (essence !== 'text/plain') {
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '粘贴正文必须使用纯文本格式', 415);
  }
}

function parseContentLength(value: string | null): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new AppError('VALIDATION_ERROR', '必须提供准确的 Content-Length', 411);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new AppError('VALIDATION_ERROR', '必须提供准确的 Content-Length', 411);
  }
  if (length > MAX_TEXT_BYTES) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }
  return length;
}

async function readExactBytes(request: Request, contentLength: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(contentLength);
  const reader = request.body?.getReader();
  if (!reader) {
    if (contentLength === 0) return bytes;
    throw new AppError('VALIDATION_ERROR', '上传长度与 Content-Length 不一致', 400);
  }
  let offset = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > contentLength ||
          offset + value.byteLength > MAX_TEXT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    request.signal.throwIfAborted();
  } finally {
    reader.releaseLock();
  }
  if (offset !== contentLength) {
    throw new AppError('VALIDATION_ERROR', '上传长度与 Content-Length 不一致', 400);
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AppError('IMPORT_CONTENT_INVALID', '正文不是有效的 UTF-8 文本', 422);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function hashRequestMaterial(material: unknown): string {
  const serialized = JSON.stringify(canonicalize(material)) ?? 'undefined';
  return createHash('sha256').update(serialized).digest('hex');
}

async function findOwnedImport(
  env: ApiEnv,
  userId: string,
  importId: string,
): Promise<ImportRow> {
  let row: ImportRow | null;
  try {
    row = await env.DB.prepare(`
      SELECT id, source_kind, status FROM article_imports
      WHERE id = ? AND user_id = ? LIMIT 1
    `).bind(importId, userId).first<ImportRow>();
  } catch {
    throw databaseUnavailable();
  }
  if (!row) throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  return row;
}

async function findIdempotencyRecord(
  env: ApiEnv,
  userId: string,
  key: string,
): Promise<IdempotencyRow | null> {
  try {
    return await env.DB.prepare(`
      SELECT request_hash, resource_id FROM idempotency_records
      WHERE user_id = ? AND operation = 'upload_import_text'
        AND idempotency_key = ? LIMIT 1
    `).bind(userId, key).first<IdempotencyRow>();
  } catch {
    throw databaseUnavailable();
  }
}

function assertReplay(record: IdempotencyRow, requestHash: string, importId: string): void {
  if (record.request_hash !== requestHash || record.resource_id !== importId) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
}

function returnedId(result: unknown, id: string): boolean {
  if (!result || typeof result !== 'object' || !('results' in result)) return false;
  const rows = result.results;
  return Array.isArray(rows) && rows.some((row: unknown) =>
    typeof row === 'object' && row !== null && 'id' in row && row.id === id);
}

async function commitPreview(
  env: ApiEnv,
  input: {
    userId: string;
    importId: string;
    key: string;
    requestHash: string;
    title: string;
    text: string;
    wordCount: number;
    contentHash: string;
    similarityFingerprint: string;
  },
): Promise<void> {
  const recordId = crypto.randomUUID();
  const now = new Date().toISOString();
  const reserve = env.DB.prepare(`
    INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, request_hash,
       resource_type, resource_id, expires_at)
    SELECT ?, ?, 'upload_import_text', ?, ?, 'article_import', ?, ?
    FROM article_imports
    WHERE id = ? AND user_id = ? AND source_kind = 'paste'
      AND status = 'awaiting_upload'
    RETURNING id
  `).bind(
    recordId, input.userId, input.key, input.requestHash, input.importId,
    new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    input.importId, input.userId,
  );
  const update = env.DB.prepare(`
    UPDATE article_imports
    SET status = 'preview_ready', preview_title = ?, preview_text = ?,
      word_count = ?, content_hash = ?, similarity_fingerprint = ?,
      failure_code = NULL, failure_message_public = NULL,
      preview_ready_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND source_kind = 'paste'
      AND status = 'awaiting_upload'
      AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
    RETURNING id
  `).bind(
    input.title, input.text, input.wordCount, input.contentHash,
    input.similarityFingerprint, now, now, input.importId, input.userId, recordId,
  );

  let results: unknown[];
  try {
    // D1 executes a batch as one transaction. The guarded reservation and
    // UPDATE either both commit or both roll back on any SQL failure.
    results = await env.DB.batch([reserve, update]);
  } catch {
    // A same-key race or uncertain D1 response can be resolved by reading the
    // committed idempotency record. Different request bytes always conflict.
    const existing = await findIdempotencyRecord(env, input.userId, input.key);
    if (existing) {
      assertReplay(existing, input.requestHash, input.importId);
      return;
    }
    throw databaseUnavailable();
  }
  if (!returnedId(results[0], recordId)) {
    throw new AppError('STATE_CONFLICT', '导入状态已变更', 409);
  }
  if (!returnedId(results[1], input.importId)) {
    throw new AppError('INTERNAL_ERROR', '导入状态暂时无法更新', 500, true);
  }
}

async function currentImportResponse(
  request: Request,
  env: ApiEnv,
  userId: string,
  importId: string,
): Promise<Response> {
  const getRequest = new Request(new URL(`/v1/imports/${importId}`, request.url));
  const response = await handleImportReadRoute(getRequest, env, userId);
  if (response === null) {
    throw new AppError('INTERNAL_ERROR', '导入任务暂时无法读取', 500, true);
  }
  return response;
}

/** Handles authenticated PUT /v1/imports/:id/source-text. */
export async function handleImportPasteRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'PUT') return null;
  const match = /^\/v1\/imports\/([^/]+)\/source-text$/u.exec(new URL(request.url).pathname);
  if (!match) return null;
  const importId = parseImportId(match[1]!);
  const key = requireIdempotencyKey(request);
  assertPlainText(request.headers.get('content-type'));
  const contentLength = parseContentLength(request.headers.get('content-length'));
  const current = await findOwnedImport(env, userId, importId);
  const bytes = await readExactBytes(request, contentLength);
  const text = decodeUtf8(bytes);
  const sourceDigest = createHash('sha256').update(bytes).digest('hex');
  const requestHash = hashRequestMaterial({ importId, sourceDigest });
  const existing = await findIdempotencyRecord(env, userId, key);
  if (existing) {
    assertReplay(existing, requestHash, importId);
    return currentImportResponse(request, env, userId, importId);
  }
  if (current.source_kind !== 'paste' || current.status !== 'awaiting_upload') {
    throw new AppError('STATE_CONFLICT', '当前导入状态不能接收正文', 409);
  }
  const normalized = await normalizePastedContentOnCpuBoundary(env, text);
  await commitPreview(env, {
    userId, importId, key, requestHash,
    title: normalized.title,
    text: normalized.text,
    wordCount: normalized.wordCount,
    contentHash: normalized.contentHash,
    similarityFingerprint: normalized.similarityFingerprint.toString(),
  });
  return currentImportResponse(request, env, userId, importId);
}

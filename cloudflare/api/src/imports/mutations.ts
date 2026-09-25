import { createHash } from 'node:crypto';

import {
  UpdateImportPreviewRequestSchema,
  UuidSchema,
  type UpdateImportPreviewRequest,
} from '@context-reader/contracts';
import { z } from 'zod';

import { AppError } from '../../../../server/src/core/errors';
import { normalizeImportContentOnCpuBoundary } from '../cpu/client';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';
import { handleImportReadRoute } from './read';
import { purgeImportAssetsForImport } from './storage';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const EMPTY_REQUEST = z.object({}).strict();
const PREVIEW_BODY_LIMIT = 128 * 1_024;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const CANCELLABLE_STATUSES = [
  'awaiting_upload', 'queued', 'processing', 'retryable', 'preview_ready',
] as const;

type ImportOperation = 'edit_import_preview' | 'cancel_article_import';

interface OwnedImportRow {
  id: string;
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
): Promise<OwnedImportRow> {
  let row: OwnedImportRow | null;
  try {
    row = await env.DB.prepare(
      'SELECT id, status FROM article_imports WHERE id = ? AND user_id = ? LIMIT 1',
    ).bind(importId, userId).first<OwnedImportRow>();
  } catch {
    throw databaseUnavailable();
  }
  if (!row) throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  return row;
}

async function findIdempotencyRecord(
  env: ApiEnv,
  userId: string,
  operation: ImportOperation,
  key: string,
): Promise<IdempotencyRow | null> {
  try {
    return await env.DB.prepare(`
      SELECT request_hash, resource_id FROM idempotency_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
    `).bind(userId, operation, key).first<IdempotencyRow>();
  } catch {
    throw databaseUnavailable();
  }
}

function assertMatchingReplay(
  record: IdempotencyRow,
  requestHash: string,
  importId: string,
): void {
  if (record.request_hash !== requestHash || record.resource_id !== importId) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
}

function returnedId(result: unknown, expectedId: string): boolean {
  if (!result || typeof result !== 'object' || !('results' in result)) return false;
  const rows = result.results;
  return Array.isArray(rows) && rows.some((row: unknown) =>
    typeof row === 'object' && row !== null && 'id' in row && row.id === expectedId);
}

async function commitMutation(
  env: ApiEnv,
  input: {
    userId: string;
    importId: string;
    operation: ImportOperation;
    key: string;
    requestHash: string;
    allowedStatuses: readonly string[];
    updateSql: string;
    updateValues: readonly unknown[];
  },
): Promise<void> {
  const recordId = crypto.randomUUID();
  const statusPlaceholders = input.allowedStatuses.map(() => '?').join(', ');
  const insert = env.DB.prepare(`
    INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, request_hash,
       resource_type, resource_id, expires_at)
    SELECT ?, ?, ?, ?, ?, 'article_import', ?, ?
    FROM article_imports
    WHERE id = ? AND user_id = ? AND status IN (${statusPlaceholders})
    RETURNING id
  `).bind(
    recordId, input.userId, input.operation, input.key, input.requestHash,
    input.importId, new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    input.importId, input.userId, ...input.allowedStatuses,
  );
  const update = env.DB.prepare(input.updateSql).bind(
    ...input.updateValues, input.importId, input.userId, ...input.allowedStatuses, recordId,
  );

  let results: unknown[];
  try {
    // D1 batch is transactional. A duplicate key or failed UPDATE rolls back
    // both the idempotency reservation and the state change.
    results = await env.DB.batch([insert, update]);
  } catch {
    // A concurrent replay, or a timeout after commit, is resolved by rereading
    // the stable idempotency record rather than repeating the mutation.
    const existing = await findIdempotencyRecord(
      env, input.userId, input.operation, input.key,
    );
    if (existing) {
      assertMatchingReplay(existing, input.requestHash, input.importId);
      return;
    }
    throw databaseUnavailable();
  }
  if (!returnedId(results[0], recordId)) {
    throw new AppError('STATE_CONFLICT', '导入状态已变更', 409);
  }
  if (!returnedId(results[1], input.importId)) {
    // This is unreachable for a normal D1 transaction: the inserted record was
    // selected from the same owned row and the batch holds the write lock.
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

async function editPreview(
  request: Request,
  env: ApiEnv,
  userId: string,
  importId: string,
  key: string,
): Promise<Response> {
  const parsed = UpdateImportPreviewRequestSchema.safeParse(
    await readJsonBody(request, PREVIEW_BODY_LIMIT),
  );
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '请检查预览内容', 400);
  }
  const body: UpdateImportPreviewRequest = parsed.data;
  const requestHash = hashRequestMaterial({ importId, ...body });
  const current = await findOwnedImport(env, userId, importId);
  const existing = await findIdempotencyRecord(env, userId, 'edit_import_preview', key);
  if (existing) {
    assertMatchingReplay(existing, requestHash, importId);
    return currentImportResponse(request, env, userId, importId);
  }
  if (current.status !== 'preview_ready') {
    throw new AppError('STATE_CONFLICT', '当前导入状态不能编辑预览', 409);
  }
  const normalized = await normalizeImportContentOnCpuBoundary(env, body);

  const now = new Date().toISOString();
  const allowedStatuses = ['preview_ready'];
  const statusPlaceholders = allowedStatuses.map(() => '?').join(', ');
  await commitMutation(env, {
    userId, importId, operation: 'edit_import_preview', key, requestHash,
    allowedStatuses,
    updateSql: `
      UPDATE article_imports
      SET preview_title = ?, preview_text = ?, word_count = ?, content_hash = ?,
        similarity_fingerprint = ?, failure_code = NULL,
        failure_message_public = NULL, preview_ready_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status IN (${statusPlaceholders})
        AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      RETURNING id
    `,
    updateValues: [
      normalized.title, normalized.text, normalized.wordCount,
      normalized.contentHash, normalized.similarityFingerprint.toString(), now, now,
    ],
  });
  return currentImportResponse(request, env, userId, importId);
}

async function cancelImport(
  request: Request,
  env: ApiEnv,
  userId: string,
  importId: string,
  key: string,
): Promise<Response> {
  const body = request.body === null || request.headers.get('content-length') === '0'
    ? {}
    : await readJsonBody(request);
  if (!EMPTY_REQUEST.safeParse(body).success) {
    throw new AppError('VALIDATION_ERROR', '取消请求格式无效', 400);
  }
  const requestHash = hashRequestMaterial({ importId });
  const current = await findOwnedImport(env, userId, importId);
  const existing = await findIdempotencyRecord(env, userId, 'cancel_article_import', key);
  if (existing) {
    assertMatchingReplay(existing, requestHash, importId);
  } else {
    if (!CANCELLABLE_STATUSES.some((status) => status === current.status)) {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能取消', 409);
    }
    const statusPlaceholders = CANCELLABLE_STATUSES.map(() => '?').join(', ');
    await commitMutation(env, {
      userId, importId, operation: 'cancel_article_import', key, requestHash,
      allowedStatuses: CANCELLABLE_STATUSES,
      updateSql: `
        UPDATE article_imports
        SET status = 'cancelled', preview_title = NULL, preview_text = NULL,
          word_count = NULL, content_hash = NULL, similarity_fingerprint = NULL,
          failure_code = NULL, failure_message_public = NULL,
          processing_started_at = NULL, preview_ready_at = NULL,
          article_id = NULL, confirmed_at = NULL, updated_at = ${DB_NOW}
        WHERE id = ? AND user_id = ? AND status IN (${statusPlaceholders})
          AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        RETURNING id
      `,
      updateValues: [],
    });
  }

  // R2 and D1 have no shared transaction. Purging after the committed cancel
  // is idempotent; a retry with the same key repeats cleanup if it failed.
  await purgeImportAssetsForImport(env, importId);
  return currentImportResponse(request, env, userId, importId);
}

/** Handles only preview editing and cancellation for authenticated imports. */
export async function handleImportMutationRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const preview = /^\/v1\/imports\/([^/]+)\/preview$/u.exec(path);
  const cancel = /^\/v1\/imports\/([^/]+)\/cancel$/u.exec(path);
  if (request.method === 'PATCH' && preview) {
    const importId = parseImportId(preview[1]!);
    return editPreview(request, env, userId, importId, requireIdempotencyKey(request));
  }
  if (request.method === 'POST' && cancel) {
    const importId = parseImportId(cancel[1]!);
    return cancelImport(request, env, userId, importId, requireIdempotencyKey(request));
  }
  return null;
}

import { createHash } from 'node:crypto';

import { UuidSchema } from '@context-reader/contracts';
import { z } from 'zod';

import { AppError } from '../../../../server/src/core/errors';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1StatementBinding } from '../env';
import { handleImportReadRoute } from './read';

const EMPTY = z.object({}).strict();
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const JOB_DEADLINE_MS = 300_000;
const ASSET_TTL_MS = 86_400_000;
const MAX_TOTAL_BYTES = 31_457_280;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

type Operation = 'start_article_import' | 'retry_article_import';
interface IdempotencyRow { request_hash: string; resource_id: string }
interface ImportRow { status: string; source_kind: string; expires_at: string }

function conflict(): AppError {
  return new AppError('STATE_CONFLICT', '当前导入状态不能开始处理', 409);
}

function unavailable(): AppError {
  return new AppError('AI_UNAVAILABLE', '文章导入服务暂时不可用', 503, true);
}

function databaseUnavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
}

async function currentImport(
  request: Request, env: ApiEnv, userId: string, importId: string,
): Promise<Response> {
  const get = new Request(new URL(`/v1/imports/${importId}`, request.url));
  const response = await handleImportReadRoute(get, env, userId);
  if (!response) throw databaseUnavailable();
  return Response.json(await response.json(), { status: 202, headers: { 'cache-control': 'no-store' } });
}

async function findReplay(
  env: ApiEnv, userId: string, operation: Operation, key: string,
): Promise<IdempotencyRow | null> {
  return env.DB.prepare(`
    SELECT request_hash, resource_id FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, operation, key).first<IdempotencyRow>();
}

function assertReplay(row: IdempotencyRow, importId: string, hash: string): void {
  if (row.resource_id !== importId || row.request_hash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
}

function guardStatement(
  env: ApiEnv, guardId: string, importId: string, userId: string, operation: Operation,
): D1StatementBinding {
  const base = `i.id = ? AND i.user_id = ? AND i.expires_at > ${DB_NOW}
    AND NOT EXISTS (SELECT 1 FROM jobs AS j WHERE j.kind = 'article_import'
      AND j.resource_id = i.id AND j.status IN ('queued', 'running'))`;
  const start = `i.status = 'awaiting_upload' AND i.source_kind IN ('album', 'local_file')
    AND json_array_length(i.asset_manifest_json) BETWEEN 1 AND 10
    AND (SELECT count(*) FROM import_assets AS a WHERE a.article_import_id = i.id)
      = json_array_length(i.asset_manifest_json)
    AND NOT EXISTS (
      SELECT 1 FROM json_each(i.asset_manifest_json) AS expected
      LEFT JOIN import_assets AS actual ON actual.article_import_id = i.id
        AND actual.position = json_extract(expected.value, '$.position')
      WHERE actual.id IS NULL OR
        actual.media_type <> json_extract(expected.value, '$.mediaType') OR
        actual.byte_size <> json_extract(expected.value, '$.byteSize')
    )
    AND (SELECT sum(a.byte_size) FROM import_assets AS a WHERE a.article_import_id = i.id)
      <= ${MAX_TOTAL_BYTES}`;
  const retry = `i.status = 'retryable' AND NOT EXISTS (
      SELECT 1 FROM import_assets AS a WHERE a.article_import_id = i.id
        AND a.created_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${ASSET_TTL_MS / 1_000} seconds')
    )`;
  return env.DB.prepare(`
    INSERT INTO transaction_guards (id, valid)
    VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM article_imports AS i
      WHERE ${base} AND ${operation === 'start_article_import' ? start : retry})
      THEN 1 ELSE 0 END)
  `).bind(guardId, importId, userId);
}

async function launch(
  request: Request, env: ApiEnv, userId: string, importId: string,
  operation: Operation, key: string,
): Promise<Response> {
  const hash = createHash('sha256').update(JSON.stringify({ importId })).digest('hex');
  const replay = await findReplay(env, userId, operation, key);
  if (replay) {
    assertReplay(replay, importId, hash);
    return currentImport(request, env, userId, importId);
  }
  if (!env.JOB_QUEUE) throw unavailable();
  const row = await env.DB.prepare(`
    SELECT status, source_kind, expires_at FROM article_imports
    WHERE id = ? AND user_id = ? LIMIT 1
  `).bind(importId, userId).first<ImportRow>();
  if (!row) throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  if (operation === 'start_article_import'
    ? row.status !== 'awaiting_upload' ||
      (row.source_kind !== 'album' && row.source_kind !== 'local_file')
    : row.status !== 'retryable') throw conflict();

  const guardId = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    await env.DB.batch([
      guardStatement(env, guardId, importId, userId, operation),
      env.DB.prepare(`
        INSERT INTO idempotency_records
          (id, user_id, operation, idempotency_key, request_hash,
           resource_type, resource_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'article_import', ?, ?, ?)
      `).bind(recordId, userId, operation, key, hash, importId, nowIso,
        new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()),
      env.DB.prepare(`
        UPDATE article_imports SET status = 'queued', processing_started_at = NULL,
          failure_code = NULL, failure_message_public = NULL, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(nowIso, importId, userId),
      env.DB.prepare(`
        INSERT INTO jobs (id, kind, resource_id, status, attempt_count,
          max_attempts, available_at, deadline_at, created_at)
        VALUES (?, 'article_import', ?, 'queued', 0, 3, ?, ?, ?)
      `).bind(jobId, importId, nowIso,
        new Date(now.getTime() + JOB_DEADLINE_MS).toISOString(), nowIso),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
    ]);
  } catch {
    const committed = await findReplay(env, userId, operation, key).catch(() => null);
    if (committed) {
      assertReplay(committed, importId, hash);
      return currentImport(request, env, userId, importId);
    }
    // The guarded CHECK aborts the whole batch when source assets or status
    // changed between preflight and commit.
    throw conflict();
  }
  await env.JOB_QUEUE.send({ jobId }).catch(() => undefined);
  return currentImport(request, env, userId, importId);
}

export async function handleImportProcessRoute(
  request: Request, env: ApiEnv, userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const match = /^\/v1\/imports\/([^/]+)\/(process|retry)$/u.exec(new URL(request.url).pathname);
  if (!match) return null;
  let importId: string;
  try { importId = decodeURIComponent(match[1]!); } catch { throw conflict(); }
  if (!UuidSchema.safeParse(importId).success) {
    throw new AppError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }
  const key = request.headers.get('idempotency-key');
  if (!key || !KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  const body = request.body === null || request.headers.get('content-length') === '0'
    ? {} : await readJsonBody(request);
  if (!EMPTY.safeParse(body).success) {
    throw new AppError('VALIDATION_ERROR', '处理请求格式无效', 400);
  }
  return launch(request, env, userId, importId,
    match[2] === 'process' ? 'start_article_import' : 'retry_article_import', key);
}

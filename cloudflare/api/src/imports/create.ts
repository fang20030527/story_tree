import { createHash } from 'node:crypto';

import { CreateArticleImportRequestSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';
import { handleImportReadRoute } from './read';
import { publicHtmlUrl } from './safe-fetch';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const DRAFT_TTL_MS = 604_800_000;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

interface IdempotencyRow { requestHash: string; resourceId: string }

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function requestHash(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(request))).digest('hex');
}

async function currentImport(
  request: Request,
  env: ApiEnv,
  userId: string,
  importId: string,
): Promise<Response> {
  const getRequest = new Request(new URL(`/v1/imports/${importId}`, request.url));
  const response = await handleImportReadRoute(getRequest, env, userId);
  if (!response) throw new AppError('INTERNAL_ERROR', '导入任务创建失败', 500, true);
  return Response.json(await response.json(), {
    status: 201,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleImportCreateRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/imports') return null;
  const key = request.headers.get('idempotency-key');
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  const parsed = CreateArticleImportRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请检查导入来源', 400);
  const source = parsed.data;
  const hash = requestHash(source);
  const operation = 'create_article_import';
  const existing = await env.DB.prepare(`
    SELECT request_hash AS requestHash, resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, operation, key).first<IdempotencyRow>();
  if (existing) {
    if (existing.requestHash !== hash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
    }
    return currentImport(request, env, userId, existing.resourceId);
  }
  // A URL immediately needs a worker. Reject it until the Queue producer is
  // bound so no newly created import can become permanently stranded.
  if (source.sourceKind !== 'paste' && !env.JOB_QUEUE) {
    throw new AppError('AI_UNAVAILABLE', '文章导入服务暂时不可用', 503, true);
  }

  const importId = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const jobId = source.sourceKind === 'url' ? crypto.randomUUID() : null;
  const now = new Date();
  const manifest = source.sourceKind === 'album' || source.sourceKind === 'local_file'
    ? JSON.stringify(source.assets) : null;
  const sourceUrl = source.sourceKind === 'url'
    ? publicHtmlUrl(source.url).toString() : null;
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO idempotency_records
        (id, user_id, operation, idempotency_key, request_hash,
          resource_type, resource_id, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, 'article_import', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)
      ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
      RETURNING id
    `).bind(recordId, userId, operation, key, hash, importId,
      now.toISOString(), new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(), userId),
    env.DB.prepare(`
      INSERT INTO article_imports
        (id, user_id, source_kind, status, source_url, asset_manifest_json,
          created_at, updated_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      RETURNING id
    `).bind(importId, userId, source.sourceKind,
      source.sourceKind === 'url' ? 'queued' : 'awaiting_upload', sourceUrl, manifest,
      now.toISOString(), now.toISOString(),
      new Date(now.getTime() + DRAFT_TTL_MS).toISOString(), recordId),
    ...(jobId ? [env.DB.prepare(`
      INSERT INTO jobs (id, kind, resource_id, status, attempt_count,
        max_attempts, available_at, deadline_at, created_at)
      SELECT ?, 'article_import', ?, 'queued', 0, 3, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM article_imports WHERE id = ? AND status = 'queued')
      RETURNING id
    `).bind(jobId, importId, now.toISOString(),
      new Date(now.getTime() + 300_000).toISOString(), now.toISOString(), importId)] : []),
  ]);
  const saved = await env.DB.prepare(`
    SELECT request_hash AS requestHash, resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, operation, key).first<IdempotencyRow>();
  if (!saved) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  if (saved.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (saved.resourceId === importId &&
      !((results[1] as { results?: Array<{ id: string }> } | undefined)?.results ?? [])
        .some((row) => row.id === importId)) {
    throw new AppError('INTERNAL_ERROR', '导入任务创建失败', 500, true);
  }
  if (jobId && saved.resourceId === importId) {
    if (!((results[2] as { results?: Array<{ id: string }> } | undefined)?.results ?? [])
      .some((row) => row.id === jobId)) {
      throw new AppError('INTERNAL_ERROR', '导入任务创建失败', 500, true);
    }
    await env.JOB_QUEUE?.send({ jobId }).catch(() => undefined);
  }
  return currentImport(request, env, userId, saved.resourceId);
}

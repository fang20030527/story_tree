import { TranslationRequestSchema, UuidSchema, type TranslationRequest } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { createTranslationSourceHash } from '../../../../server/src/modules/translation/validation';
import { generationDeadlineMs } from '../ai/provider';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1DatabaseBinding } from '../env';
import { translationResponseForUser } from './read';

const PRACTICE_PATH = /^\/v1\/practices\/([^/]+)\/translations$/u;
const ARTICLE_PATH = /^\/v1\/articles\/([^/]+)\/translations$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface IdRow { id: string }
interface ExistingRecord { requestHash: string; resourceId: string }
interface SourceRow { status?: string; plainText?: string }

function parseId(raw: string, article: boolean): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', article ? '文章编号格式无效' : '练习编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(id).success) {
    throw new AppError('VALIDATION_ERROR', article ? '文章编号格式无效' : '练习编号格式无效', 400);
  }
  return id;
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return key;
}

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

async function requestHash(resourceId: string, request: TranslationRequest, article: boolean): Promise<string> {
  const material = { [article ? 'articleId' : 'practiceId']: resourceId, ...request };
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalize(material)));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadSource(
  db: D1DatabaseBinding,
  userId: string,
  resourceId: string,
  request: TranslationRequest,
  article: boolean,
): Promise<string> {
  if (article) {
    const owner = await db.prepare('SELECT id FROM imported_articles WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(resourceId, userId).first<IdRow>();
    if (!owner) throw new AppError('NOT_FOUND', '文章不存在', 404);
  } else {
    const practice = await db.prepare('SELECT status FROM practice_sessions WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(resourceId, userId).first<SourceRow>();
    if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
    if (!['ready', 'in_progress', 'completed'].includes(practice.status ?? '')) {
      throw new AppError('STATE_CONFLICT', '练习尚未准备完成', 409, true);
    }
  }

  const paragraphTable = article ? 'article_paragraphs' : 'practice_paragraphs';
  const ownerColumn = article ? 'article_id' : 'practice_session_id';
  if (request.scope === 'paragraph') {
    const paragraph = await db.prepare(`
      SELECT plain_text AS plainText FROM ${paragraphTable}
      WHERE id = ? AND ${ownerColumn} = ? LIMIT 1
    `).bind(request.paragraphId, resourceId).first<SourceRow>();
    if (!paragraph?.plainText) throw new AppError('NOT_FOUND', '段落不存在', 404);
    return paragraph.plainText;
  }
  const paragraphs = await db.prepare(`
    SELECT plain_text AS plainText FROM ${paragraphTable}
    WHERE ${ownerColumn} = ? ORDER BY position ASC
  `).bind(resourceId).all<SourceRow>();
  if (paragraphs.results.length === 0 || paragraphs.results.some((row) => !row.plainText)) {
    throw new AppError('INTERNAL_ERROR', article ? '翻译来源无效' : '练习正文不存在', 500, true);
  }
  return paragraphs.results.map((row) => row.plainText).join('\n\n');
}

function resultRows<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('results' in result)) return [];
  const value = result.results;
  return Array.isArray(value) ? value as T[] : [];
}

export async function handleTranslationRequestRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const pathname = new URL(request.url).pathname;
  const practiceMatch = PRACTICE_PATH.exec(pathname);
  const articleMatch = ARTICLE_PATH.exec(pathname);
  if (!practiceMatch && !articleMatch) return null;
  const article = articleMatch !== null;
  const resourceId = parseId((practiceMatch ?? articleMatch)![1]!, article);
  const key = idempotencyKey(request);
  const parsed = TranslationRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '翻译范围格式无效', 400);
  if (!env.JOB_QUEUE || !env.EVOLINK_API_KEY) {
    throw new AppError('AI_UNAVAILABLE', '翻译服务暂时不可用', 503, true);
  }

  const operation = article ? 'request_article_translation' : 'request_translation';
  const table = article ? 'article_translations' : 'translations';
  const foreignKey = article ? 'article_id' : 'practice_session_id';
  const kind = article ? 'article_translation' : 'translation';
  const hash = await requestHash(resourceId, parsed.data, article);
  const existing = await env.DB.prepare(`
    SELECT request_hash AS requestHash, resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, operation, key).first<ExistingRecord>();
  if (existing) {
    if (existing.requestHash !== hash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
    }
    return acceptedResponse(env, userId, existing.resourceId, article);
  }

  const source = await loadSource(env.DB, userId, resourceId, parsed.data, article);
  const paragraphId = parsed.data.scope === 'paragraph' ? parsed.data.paragraphId : null;
  const sourceHash = createTranslationSourceHash(resourceId, parsed.data.scope, paragraphId, source);
  const now = new Date();
  const recordId = crypto.randomUUID();
  const translationId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const cachePredicate = `${foreignKey} = ? AND scope = ? AND paragraph_id IS ? AND source_hash = ?`;
  const cacheBindings = [resourceId, parsed.data.scope, paragraphId, sourceHash];
  const batch = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO idempotency_records
        (id, user_id, operation, idempotency_key, request_hash,
          resource_type, resource_id, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM ${table} AS cached
        WHERE ${cachePredicate}
          AND cached.status = 'failed'
          AND EXISTS (
            SELECT 1 FROM jobs WHERE kind = ? AND resource_id = cached.id
              AND status IN ('queued', 'running')
          )
      )
      ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
      RETURNING id
    `).bind(recordId, userId, operation, key, hash, kind, translationId,
      now.toISOString(), new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
      ...cacheBindings, kind),
    env.DB.prepare(`
      INSERT INTO ${table}
        (id, ${foreignKey}, scope, paragraph_id, source_hash, status)
      SELECT ?, ?, ?, ?, ?, 'queued'
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM ${table} WHERE ${cachePredicate})
      ON CONFLICT DO NOTHING RETURNING id
    `).bind(translationId, resourceId, parsed.data.scope, paragraphId, sourceHash,
      recordId, ...cacheBindings),
    env.DB.prepare(`
      UPDATE ${table} SET status = 'queued', translated_text_zh = NULL,
        ${article ? 'failure_code = NULL, failure_message_public = NULL,' : ''}
        ready_at = NULL
      WHERE ${cachePredicate} AND status = 'failed'
        AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM jobs WHERE kind = ? AND resource_id = ${table}.id
            AND status IN ('queued', 'running')
        )
      RETURNING id
    `).bind(...cacheBindings, recordId, kind),
    env.DB.prepare(`
      UPDATE idempotency_records
      SET resource_id = (SELECT id FROM ${table} WHERE ${cachePredicate} LIMIT 1)
      WHERE id = ? AND EXISTS (SELECT 1 FROM ${table} WHERE ${cachePredicate})
      RETURNING resource_id AS id
    `).bind(...cacheBindings, recordId, ...cacheBindings),
    env.DB.prepare(`
      INSERT INTO jobs
        (id, kind, resource_id, status, attempt_count, max_attempts,
          available_at, deadline_at)
      SELECT ?, ?, record.resource_id, 'queued', 0, 3, ?, ?
      FROM idempotency_records AS record
      JOIN ${table} AS translated ON translated.id = record.resource_id
      WHERE record.id = ? AND translated.status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM jobs WHERE kind = ? AND resource_id = record.resource_id
            AND status IN ('queued', 'running')
        )
      ON CONFLICT DO NOTHING RETURNING id
    `).bind(jobId, kind, now.toISOString(),
      new Date(now.getTime() + generationDeadlineMs(env)).toISOString(), recordId, kind),
  ]);
  const saved = await env.DB.prepare(`
    SELECT request_hash AS requestHash, resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, operation, key).first<ExistingRecord>();
  if (!saved) throw new AppError('STATE_CONFLICT', '翻译状态正在更新，请重试', 409, true);
  if (saved.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  const newlyCreated = resultRows<IdRow>(batch[0]).length > 0;
  const insertedJob = resultRows<IdRow>(batch[4])[0];
  if (newlyCreated && insertedJob) {
    try {
      await env.JOB_QUEUE.send({ jobId: insertedJob.id });
    } catch {
      // D1 is the source of truth. Cron will dispatch this queued job.
    }
  }
  return acceptedResponse(env, userId, saved.resourceId, article);
}

async function acceptedResponse(
  env: ApiEnv,
  userId: string,
  translationId: string,
  article: boolean,
): Promise<Response> {
  const response = await translationResponseForUser(env, userId, translationId, article);
  const body = await response.json() as { status: string };
  return Response.json(body, {
    status: body.status === 'ready' ? 200 : 202,
    headers: { 'cache-control': 'no-store' },
  });
}

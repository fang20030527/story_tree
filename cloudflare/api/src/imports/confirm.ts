import { createHash } from 'node:crypto';

import {
  ConfirmArticleImportRequestSchema,
  UuidSchema,
  type ConfirmArticleImportRequest,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import {
  hammingDistance64,
  isSimilarContent,
  type NormalizedImportContent,
} from '../../../../server/src/modules/imports/content';
import { normalizeImportContentOnCpuBoundary } from '../cpu/client';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1StatementBinding } from '../env';
import { parseStoredMedia } from './media';
import { handleImportReadRoute } from './read';
import { purgeImportAssetsForImport } from './storage';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

interface ImportRow {
  id: string;
  source_kind: string;
  source_url: string | null;
  status: string;
  preview_title: string | null;
  preview_text: string | null;
  preview_media_json: string | null;
  word_count: number | null;
  content_hash: string | null;
  similarity_fingerprint: string | null;
}

interface IdempotencyRow {
  request_hash: string;
  resource_id: string;
}

interface ArticleRow {
  id: string;
  word_count: number;
  similarity_fingerprint: string;
}

type Duplicate =
  | { kind: 'none' }
  | { kind: 'exact'; articleId: string }
  | { kind: 'similar'; articleId: string };

interface Resolution {
  createArticle: boolean;
  previousVersionId: string | null;
  fallbackArticleId: string | null;
}

function databaseUnavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
}

function unreadablePreview(): AppError {
  return new AppError('INTERNAL_ERROR', '导入预览暂时无法读取', 500, true);
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

async function queryFirst<T>(
  env: ApiEnv,
  sql: string,
  params: readonly unknown[],
): Promise<T | null> {
  try {
    return await env.DB.prepare(sql).bind(...params).first<T>();
  } catch {
    throw databaseUnavailable();
  }
}

async function queryAll<T>(
  env: ApiEnv,
  sql: string,
  params: readonly unknown[],
): Promise<T[]> {
  try {
    const result = await env.DB.prepare(sql).bind(...params).all<T>();
    return result.results;
  } catch {
    throw databaseUnavailable();
  }
}

async function findOwnedImport(
  env: ApiEnv,
  userId: string,
  importId: string,
): Promise<ImportRow> {
  const row = await queryFirst<ImportRow>(env, `
    SELECT id, source_kind, source_url, status, preview_title, preview_text,
      preview_media_json,
      word_count, content_hash, similarity_fingerprint
    FROM article_imports WHERE id = ? AND user_id = ? LIMIT 1
  `, [importId, userId]);
  if (!row) throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  return row;
}

async function findIdempotencyRecord(
  env: ApiEnv,
  userId: string,
  key: string,
): Promise<IdempotencyRow | null> {
  return queryFirst<IdempotencyRow>(env, `
    SELECT request_hash, resource_id FROM idempotency_records
    WHERE user_id = ? AND operation = 'confirm_article_import'
      AND idempotency_key = ? LIMIT 1
  `, [userId, key]);
}

function assertReplay(record: IdempotencyRow, requestHash: string, importId: string): void {
  if (record.request_hash !== requestHash || record.resource_id !== importId) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
}

function parseFingerprint(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) throw unreadablePreview();
  try {
    const fingerprint = BigInt(value);
    if (BigInt.asIntN(64, fingerprint) !== fingerprint) throw unreadablePreview();
    return fingerprint;
  } catch {
    throw unreadablePreview();
  }
}

async function findDuplicate(
  env: ApiEnv,
  userId: string,
  content: NormalizedImportContent,
): Promise<Duplicate> {
  const exact = await queryFirst<{ id: string }>(env, `
    SELECT id FROM imported_articles
    WHERE user_id = ? AND content_hash = ? LIMIT 1
  `, [userId, content.contentHash]);
  if (exact) return { kind: 'exact', articleId: exact.id };

  const minimumWords = Math.ceil(content.wordCount / 1.25);
  const maximumWords = Math.floor(content.wordCount / 0.8);
  const candidates = await queryAll<ArticleRow>(env, `
    SELECT id, word_count, similarity_fingerprint FROM imported_articles
    WHERE user_id = ? AND word_count >= ? AND word_count <= ?
    ORDER BY created_at DESC, id DESC LIMIT 500
  `, [userId, minimumWords, maximumWords]);
  let nearest: { id: string; distance: number } | null = null;
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.word_count) || candidate.word_count < 1) {
      throw unreadablePreview();
    }
    const candidateFingerprint = parseFingerprint(candidate.similarity_fingerprint);
    if (!isSimilarContent(
      { fingerprint: content.similarityFingerprint, wordCount: content.wordCount },
      { fingerprint: candidateFingerprint, wordCount: candidate.word_count },
    )) continue;
    const distance = hammingDistance64(content.similarityFingerprint, candidateFingerprint);
    if (nearest === null || distance < nearest.distance) {
      nearest = { id: candidate.id, distance };
    }
  }
  return nearest ? { kind: 'similar', articleId: nearest.id } : { kind: 'none' };
}

function resolveArticle(
  duplicate: Duplicate,
  decision: ConfirmArticleImportRequest['similarityDecision'],
): Resolution {
  if (duplicate.kind === 'exact') {
    return { createArticle: false, previousVersionId: null, fallbackArticleId: duplicate.articleId };
  }
  if (duplicate.kind === 'similar') {
    if (!decision) {
      throw new AppError(
        'SIMILAR_ARTICLE_REQUIRES_DECISION',
        '发现相似文章，请选择打开已有文章或保存新版本',
        409,
      );
    }
    if (decision === 'open_existing') {
      return { createArticle: false, previousVersionId: null, fallbackArticleId: duplicate.articleId };
    }
    return { createArticle: true, previousVersionId: duplicate.articleId, fallbackArticleId: null };
  }
  if (decision !== undefined) {
    throw new AppError('VALIDATION_ERROR', '当前没有需要处理的相似文章', 400);
  }
  return { createArticle: true, previousVersionId: null, fallbackArticleId: null };
}

function returnedId(result: unknown, id: string): boolean {
  if (!result || typeof result !== 'object' || !('results' in result)) return false;
  const rows = result.results;
  return Array.isArray(rows) && rows.some((row: unknown) =>
    typeof row === 'object' && row !== null && 'id' in row && row.id === id);
}

async function commitConfirmation(
  env: ApiEnv,
  input: {
    userId: string;
    importId: string;
    key: string;
    requestHash: string;
    current: ImportRow;
    content: NormalizedImportContent;
    duplicate: Duplicate;
    resolution: Resolution;
  },
): Promise<void> {
  const recordId = crypto.randomUUID();
  const articleId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1StatementBinding[] = [];

  // This snapshot guard makes a concurrent preview edit lose cleanly instead
  // of confirming a stale title, text, hash or similarity decision.
  statements.push(env.DB.prepare(`
    INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, request_hash,
       resource_type, resource_id, expires_at)
    SELECT ?, ?, 'confirm_article_import', ?, ?, 'article_import', ?, ?
    FROM article_imports
    WHERE id = ? AND user_id = ? AND status = 'preview_ready'
      AND preview_title = ? AND preview_text = ?
      AND COALESCE(preview_media_json, '[]') = ? AND word_count = ?
      AND content_hash = ? AND similarity_fingerprint = ?
    RETURNING id
  `).bind(
    recordId, input.userId, input.key, input.requestHash, input.importId,
    new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    input.importId, input.userId, input.current.preview_title,
    input.current.preview_text, input.current.preview_media_json ?? '[]',
    input.current.word_count,
    input.current.content_hash, input.current.similarity_fingerprint,
  ));

  if (input.resolution.createArticle) {
    statements.push(env.DB.prepare(`
      INSERT INTO imported_articles
        (id, user_id, source_kind, source_url, title, media_json, word_count,
         content_hash, similarity_fingerprint, previous_version_id, imported_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      ON CONFLICT(user_id, content_hash) DO NOTHING
      RETURNING id
    `).bind(
      articleId, input.userId, input.current.source_kind, input.current.source_url,
      input.content.title, JSON.stringify(input.content.media), input.content.wordCount, input.content.contentHash,
      input.content.similarityFingerprint.toString(), input.resolution.previousVersionId,
      now, recordId,
    ));

    // One JSON parameter supports thousands of paragraphs while staying below
    // D1 Free's 100 bound-parameter and 50-query limits per invocation.
    const paragraphs = JSON.stringify(input.content.paragraphs.map((text) => ({
      id: crypto.randomUUID(), text,
    })));
    statements.push(env.DB.prepare(`
      INSERT INTO article_paragraphs (id, article_id, position, plain_text)
      SELECT json_extract(entry.value, '$.id'), ?, CAST(entry.key AS INTEGER),
        json_extract(entry.value, '$.text')
      FROM json_each(?) AS entry
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        AND EXISTS (
          SELECT 1 FROM imported_articles
          WHERE id = ? AND user_id = ? AND content_hash = ?
        )
    `).bind(
      articleId, paragraphs, recordId, articleId, input.userId, input.content.contentHash,
    ));
  }

  if (input.duplicate.kind === 'exact' && input.current.source_kind === 'url' &&
      input.content.media.length > 0) {
    statements.push(env.DB.prepare(`
      UPDATE imported_articles SET media_json = ?
      WHERE id = ? AND user_id = ? AND source_url = ?
        AND (media_json IS NULL OR json_array_length(media_json) = 0)
        AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
    `).bind(JSON.stringify(input.content.media), input.duplicate.articleId,
      input.userId, input.current.source_url, recordId));
  }

  const updateIndex = statements.length;
  statements.push(env.DB.prepare(`
    UPDATE article_imports
    SET status = 'confirmed',
      article_id = COALESCE(
        (SELECT id FROM imported_articles WHERE user_id = ? AND content_hash = ? LIMIT 1),
        ?
      ),
      confirmed_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'preview_ready'
      AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
    RETURNING id
  `).bind(
    input.userId, input.content.contentHash, input.resolution.fallbackArticleId,
    now, now, input.importId, input.userId, recordId,
  ));
  statements.push(env.DB.prepare(`
    DELETE FROM import_assets
    WHERE article_import_id = ?
      AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      AND EXISTS (
        SELECT 1 FROM article_imports WHERE id = ? AND status = 'confirmed'
      )
  `).bind(input.importId, recordId, input.importId));

  let results: unknown[];
  try {
    results = await env.DB.batch(statements);
  } catch {
    // An uncertain response may follow a committed batch, or another request
    // may have won the same idempotency key. A committed record is authoritative.
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
  if (!returnedId(results[updateIndex], input.importId)) {
    // The UPDATE is guaranteed by the reservation and article lookup on a
    // normal D1 transaction; report an explicit error if data is inconsistent.
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

async function confirmImport(
  request: Request,
  env: ApiEnv,
  userId: string,
  importId: string,
  key: string,
): Promise<Response> {
  const parsed = ConfirmArticleImportRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '请检查确认选项', 400);
  }
  const body = parsed.data;
  const requestHash = hashRequestMaterial({ importId, ...body });
  const current = await findOwnedImport(env, userId, importId);
  const existing = await findIdempotencyRecord(env, userId, key);
  if (existing) {
    assertReplay(existing, requestHash, importId);
  } else {
    if (current.status !== 'preview_ready') {
      throw new AppError('STATE_CONFLICT', '当前导入状态不能确认', 409);
    }
    if (current.preview_title === null || current.preview_text === null ||
        current.word_count === null || current.content_hash === null ||
        current.similarity_fingerprint === null) {
      throw unreadablePreview();
    }
    // Re-normalize the stored preview, exactly as the original service does.
    const content = await normalizeImportContentOnCpuBoundary(env, {
      title: current.preview_title,
      text: current.preview_text,
      media: parseStoredMedia(current.preview_media_json),
    });
    const duplicate = await findDuplicate(env, userId, content);
    const resolution = resolveArticle(duplicate, body.similarityDecision);
    await commitConfirmation(env, {
      userId, importId, key, requestHash, current, content, duplicate, resolution,
    });
  }

  // R2 cannot join the D1 transaction. This purge is safe on replay if a
  // previous attempt committed D1 but lost its response or failed cleanup.
  await purgeImportAssetsForImport(env, importId);
  return currentImportResponse(request, env, userId, importId);
}

/** Handles only POST /v1/imports/:id/confirm after caller authentication. */
export async function handleImportConfirmRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const match = /^\/v1\/imports\/([^/]+)\/confirm$/u.exec(new URL(request.url).pathname);
  if (!match) return null;
  const importId = parseImportId(match[1]!);
  const key = requireIdempotencyKey(request);
  return confirmImport(request, env, userId, importId, key);
}

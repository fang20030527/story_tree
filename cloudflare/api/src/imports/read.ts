import { ArticleImportDtoSchema, UuidSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

interface ImportRow {
  id: string;
  source_kind: string;
  status: string;
  preview_title: string | null;
  preview_text: string | null;
  word_count: number | null;
  content_hash: string | null;
  similarity_fingerprint: string | null;
  failure_code: string | null;
  failure_message_public: string | null;
  article_id: string | null;
  created_at: string;
  expires_at: string;
}

interface ArticleRow {
  id: string;
  title: string;
  word_count: number;
}

interface SimilarArticleRow extends ArticleRow {
  similarity_fingerprint: string;
}

type DuplicateMatch =
  | { kind: 'none' }
  | { kind: 'exact'; article: { id: string; title: string; wordCount: number } }
  | {
      kind: 'similar';
      article: { id: string; title: string; wordCount: number; hammingDistance: number };
    };

function unreadablePreview(): AppError {
  return new AppError('INTERNAL_ERROR', '导入预览暂时无法读取', 500, true);
}

function databaseUnavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
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

function parseFingerprint(value: string | null): bigint {
  if (value === null || !/^-?(?:0|[1-9]\d*)$/u.test(value)) {
    throw unreadablePreview();
  }
  try {
    const fingerprint = BigInt(value);
    if (BigInt.asIntN(64, fingerprint) !== fingerprint) throw unreadablePreview();
    return fingerprint;
  } catch {
    throw unreadablePreview();
  }
}

function hammingDistance64(left: bigint, right: bigint): number {
  let difference = BigInt.asUintN(64, left) ^ BigInt.asUintN(64, right);
  let count = 0;
  while (difference !== 0n) {
    difference &= difference - 1n;
    count += 1;
  }
  return count;
}

async function findDuplicate(
  env: ApiEnv,
  userId: string,
  row: ImportRow,
): Promise<DuplicateMatch> {
  if (row.content_hash === null || row.word_count === null) throw unreadablePreview();
  const fingerprint = parseFingerprint(row.similarity_fingerprint);
  if (!Number.isInteger(row.word_count) || row.word_count < 1) throw unreadablePreview();

  const exact = await queryFirst<ArticleRow>(env, `
    SELECT id, title, word_count
    FROM imported_articles
    WHERE user_id = ? AND content_hash = ?
    LIMIT 1
  `, [userId, row.content_hash]);
  if (exact) {
    return {
      kind: 'exact',
      article: { id: exact.id, title: exact.title, wordCount: exact.word_count },
    };
  }

  // Match the PostgreSQL repository's candidate range, ordering and 500-row cap.
  const minimumWords = Math.ceil(row.word_count / 1.25);
  const maximumWords = Math.floor(row.word_count / 0.8);
  const candidates = await queryAll<SimilarArticleRow>(env, `
    SELECT id, title, word_count, similarity_fingerprint
    FROM imported_articles
    WHERE user_id = ? AND word_count >= ? AND word_count <= ?
    ORDER BY created_at DESC, id DESC
    LIMIT 500
  `, [userId, minimumWords, maximumWords]);

  let nearest: { article: SimilarArticleRow; hammingDistance: number } | null = null;
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.word_count) || candidate.word_count < 1) {
      throw unreadablePreview();
    }
    const candidateFingerprint = parseFingerprint(candidate.similarity_fingerprint);
    const ratio = row.word_count / candidate.word_count;
    if (ratio < 0.8 || ratio > 1.25) continue;
    const distance = hammingDistance64(fingerprint, candidateFingerprint);
    if (distance > 3) continue;
    if (nearest === null || distance < nearest.hammingDistance) {
      nearest = { article: candidate, hammingDistance: distance };
    }
  }
  if (nearest === null) return { kind: 'none' };
  return {
    kind: 'similar',
    article: {
      id: nearest.article.id,
      title: nearest.article.title,
      wordCount: nearest.article.word_count,
      hammingDistance: nearest.hammingDistance,
    },
  };
}

function isoDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AppError('INTERNAL_ERROR', '导入任务暂时无法读取', 500, true);
  }
  return date.toISOString();
}

/** Returns null for all routes except the authenticated import detail GET. */
export async function handleImportReadRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const match = /^\/v1\/imports\/([^/]+)$/u.exec(new URL(request.url).pathname);
  if (!match) return null;
  let importId: string;
  try {
    importId = decodeURIComponent(match[1]!);
  } catch {
    throw new AppError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(importId).success) {
    throw new AppError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }

  const row = await queryFirst<ImportRow>(env, `
    SELECT id, source_kind, status, preview_title, preview_text, word_count,
      content_hash, similarity_fingerprint, failure_code, failure_message_public,
      article_id, created_at, expires_at
    FROM article_imports
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `, [importId, userId]);
  if (!row) throw new AppError('NOT_FOUND', '导入任务不存在', 404);

  const polling = row.status === 'awaiting_upload' || row.status === 'queued' ||
    row.status === 'processing';
  const failed = row.status === 'retryable' || row.status === 'failed';
  const duplicate = row.status === 'preview_ready'
    ? await findDuplicate(env, userId, row)
    : { kind: 'none' as const };
  const result = ArticleImportDtoSchema.parse({
    id: row.id,
    sourceKind: row.source_kind,
    status: row.status,
    createdAt: isoDate(row.created_at),
    expiresAt: isoDate(row.expires_at),
    ...(polling ? { pollAfterMs: 1_500 } : {}),
    failure: failed
      ? {
          code: row.failure_code,
          message: row.failure_message_public,
          retryable: row.status === 'retryable',
        }
      : null,
    preview: row.status === 'preview_ready'
      ? {
          title: row.preview_title,
          text: row.preview_text,
          wordCount: row.word_count,
          duplicate,
        }
      : null,
    articleId: row.status === 'confirmed' ? row.article_id : null,
  });
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}

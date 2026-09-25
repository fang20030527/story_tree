import {
  ImportedArticleDtoSchema,
  ImportedArticlePageSchema,
  UuidSchema,
} from '@context-reader/contracts';
import { z } from 'zod';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';
import { parseStoredMedia } from '../imports/media';

const ARTICLE_LIMIT_PATTERN = /^\d{1,3}$/u;
const ARTICLE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MAX_ARTICLE_CURSOR_LENGTH = 512;
const ARTICLE_PATH = /^\/v1\/articles\/([^/]+)$/u;

const ArticleCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: UuidSchema,
}).strict();

type ArticleCursor = z.infer<typeof ArticleCursorSchema>;

interface ArticleRow {
  id: string;
  sourceKind: string;
  sourceUrl: string | null;
  title: string;
  wordCount: number;
  importedAt: string;
  createdAt: string;
  mediaJson?: string | null;
}

interface ArticleParagraphRow {
  id: string;
  position: number;
  text: string;
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_ERROR', '文章游标格式无效', 400);
}

function articleLimit(query: URLSearchParams): number {
  const values = query.getAll('limit');
  if (values.length === 0) return 30;
  const raw = values[0];
  if (values.length !== 1 || raw === undefined || !ARTICLE_LIMIT_PATTERN.test(raw)) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  const limit = Number.parseInt(raw, 10);
  if (limit < 1 || limit > 100) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  return limit;
}

function articleCursor(query: URLSearchParams): ArticleCursor | null {
  const values = query.getAll('cursor');
  if (values.length === 0) return null;
  const raw = values[0];
  if (values.length !== 1 || raw === undefined) throw invalidCursor();
  return decodeArticleCursor(raw);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function encodeArticleCursor(cursor: ArticleCursor): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

function decodeArticleCursor(raw: string): ArticleCursor {
  if (raw.length === 0 || raw.length > MAX_ARTICLE_CURSOR_LENGTH || !ARTICLE_CURSOR_PATTERN.test(raw)) {
    throw invalidCursor();
  }
  let parsed: unknown;
  try {
    const padded = raw.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (base64Url(bytes) !== raw) throw invalidCursor();
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw invalidCursor();
  }
  const result = ArticleCursorSchema.safeParse(parsed);
  if (!result.success) throw invalidCursor();
  return result.data;
}

function jsonReadResponse(request: Request, body: unknown): Response {
  const headers = { 'cache-control': 'no-store' };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return Response.json(body, { status: 200, headers });
}

export async function handleArticlesRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (url.pathname === '/v1/articles') {
    return listArticles(request, env, userId, url.searchParams);
  }
  const match = ARTICLE_PATH.exec(url.pathname);
  if (!match) return null;
  let articleId: string;
  try {
    articleId = decodeURIComponent(match[1]!);
  } catch {
    throw new AppError('VALIDATION_ERROR', '文章编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(articleId).success) {
    throw new AppError('VALIDATION_ERROR', '文章编号格式无效', 400);
  }
  return getArticle(request, env, userId, articleId);
}

async function listArticles(
  request: Request,
  env: ApiEnv,
  userId: string,
  query: URLSearchParams,
): Promise<Response> {
  const cursor = articleCursor(query);
  const limit = articleLimit(query);
  const cursorPredicate = cursor === null
    ? ''
    : 'AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))';
  const limitPlaceholder = cursor === null ? '?2' : '?4';
  const bindings: Array<string | number> = [userId];
  if (cursor !== null) {
    // PostgreSQL emitted six fractional digits. D1 migration normalizes every
    // timestamp to milliseconds, so canonicalize old opaque cursors as well.
    bindings.push(new Date(cursor.createdAt).toISOString(), cursor.id);
  }
  bindings.push(limit + 1);
  const rows = await env.DB.prepare(`
    SELECT id, source_kind AS sourceKind, source_url AS sourceUrl,
      title, word_count AS wordCount, imported_at AS importedAt,
      created_at AS createdAt
    FROM imported_articles
    WHERE user_id = ?1 ${cursorPredicate}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limitPlaceholder}
  `).bind(...bindings).all<ArticleRow>();

  const pageRows = rows.results.slice(0, limit);
  const lastRow = pageRows.at(-1);
  const nextCursor = rows.results.length > limit && lastRow
    ? encodeArticleCursor({ createdAt: new Date(lastRow.createdAt).toISOString(), id: lastRow.id })
    : null;
  const page = ImportedArticlePageSchema.parse({
    items: pageRows.map((row) => ({
      id: row.id,
      sourceKind: row.sourceKind,
      sourceUrl: row.sourceUrl,
      title: row.title,
      wordCount: row.wordCount,
      importedAt: new Date(row.importedAt).toISOString(),
    })),
    nextCursor,
  });
  return jsonReadResponse(request, page);
}

async function getArticle(
  request: Request,
  env: ApiEnv,
  userId: string,
  articleId: string,
): Promise<Response> {
  const article = await env.DB.prepare(`
    SELECT id, source_kind AS sourceKind, source_url AS sourceUrl,
      title, media_json AS mediaJson, word_count AS wordCount, imported_at AS importedAt,
      created_at AS createdAt
    FROM imported_articles
    WHERE id = ?1 AND user_id = ?2
    LIMIT 1
  `).bind(articleId, userId).first<ArticleRow>();
  if (!article) throw new AppError('NOT_FOUND', '文章不存在', 404);

  const paragraphs = await env.DB.prepare(`
    SELECT id, position, plain_text AS text
    FROM article_paragraphs
    WHERE article_id = ?1
    ORDER BY position ASC
  `).bind(article.id).all<ArticleParagraphRow>();
  if (paragraphs.results.length === 0) {
    throw new AppError('INTERNAL_ERROR', '文章正文暂时无法读取', 500, true);
  }
  const result = ImportedArticleDtoSchema.parse({
    id: article.id,
    sourceKind: article.sourceKind,
    sourceUrl: article.sourceUrl,
    title: article.title,
    wordCount: article.wordCount,
    importedAt: new Date(article.importedAt).toISOString(),
    media: parseStoredMedia(article.mediaJson ?? null),
    paragraphs: paragraphs.results,
  });
  return jsonReadResponse(request, result);
}

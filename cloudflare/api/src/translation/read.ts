import {
  ArticleTranslationDtoSchema,
  TranslationDtoSchema,
  UuidSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

interface TranslationRow {
  id: string;
  status: string;
  scope: string;
  paragraphId: string | null;
  translatedTextZh: string | null;
  failureCode?: string | null;
  failureMessagePublic?: string | null;
}

function parseTranslationId(value: string): string {
  let id: string;
  try {
    id = decodeURIComponent(value);
  } catch {
    throw new AppError('VALIDATION_ERROR', '翻译编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(id).success) {
    throw new AppError('VALIDATION_ERROR', '翻译编号格式无效', 400);
  }
  return id;
}

export async function handleTranslationReadRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const pathname = new URL(request.url).pathname;
  const practiceMatch = /^\/v1\/translations\/([^/]+)$/u.exec(pathname);
  const articleMatch = /^\/v1\/article-translations\/([^/]+)$/u.exec(pathname);
  if (!practiceMatch && !articleMatch) return null;
  const id = parseTranslationId((practiceMatch ?? articleMatch)![1]!);
  const article = articleMatch !== null;
  return translationResponseForUser(env, userId, id, article);
}

export async function translationResponseForUser(
  env: ApiEnv,
  userId: string,
  id: string,
  article: boolean,
): Promise<Response> {
  const row = article
    ? await env.DB.prepare(`
      SELECT t.id, t.status, t.scope, t.paragraph_id AS paragraphId,
        t.translated_text_zh AS translatedTextZh,
        t.failure_code AS failureCode,
        t.failure_message_public AS failureMessagePublic
      FROM article_translations AS t
      JOIN imported_articles AS a ON a.id = t.article_id
      WHERE t.id = ? AND a.user_id = ?
      LIMIT 1
    `).bind(id, userId).first<TranslationRow>()
    : await env.DB.prepare(`
      SELECT t.id, t.status, t.scope, t.paragraph_id AS paragraphId,
        t.translated_text_zh AS translatedTextZh
      FROM translations AS t
      JOIN practice_sessions AS p ON p.id = t.practice_session_id
      WHERE t.id = ? AND p.user_id = ?
      LIMIT 1
    `).bind(id, userId).first<TranslationRow>();
  if (!row) throw new AppError('NOT_FOUND', '翻译不存在', 404);
  if (row.status === 'ready' && !row.translatedTextZh) {
    throw new AppError('INTERNAL_ERROR', '翻译内容暂时无法读取', 500, true);
  }
  const active = row.status === 'queued' || row.status === 'generating';
  const failure = row.status === 'failed'
    ? article
      ? {
          code: row.failureCode,
          message: row.failureMessagePublic,
          retryable: true,
        }
      : {
          code: 'AI_UNAVAILABLE',
          message: '翻译暂时无法完成',
          retryable: true,
        }
    : null;
  const body = {
    id: row.id,
    status: row.status,
    scope: row.scope,
    paragraphId: row.paragraphId,
    translatedTextZh: row.status === 'ready' ? row.translatedTextZh : null,
    ...(active ? { pollAfterMs: 1_500 } : {}),
    failure,
  };
  return Response.json(article
    ? ArticleTranslationDtoSchema.parse(body)
    : TranslationDtoSchema.parse(body), {
    headers: { 'cache-control': 'no-store' },
  });
}

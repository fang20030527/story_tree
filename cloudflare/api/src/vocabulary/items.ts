import {
  UuidSchema,
  VocabularyPageSchema,
  VocabularyWordContextsSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

interface Cursor {
  createdAt: string;
  id: string;
}

interface ItemRow {
  id: string;
  term: string;
  meaning_zh: string;
  source_sentence: string | null;
  status: string;
  created_at: string;
  practice_count: number;
  first_try_correct_count: number;
  assisted_count: number;
  last_practiced_at: string | null;
}

function badCursor(): AppError {
  return new AppError('VALIDATION_ERROR', '词库游标格式无效', 400);
}

function parseLimit(value: string | null): number {
  if (value === null) return 20;
  if (!/^\d{1,2}$/u.test(value)) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  const limit = Number(value);
  if (limit < 1 || limit > 50) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  return limit;
}

function decodeCursor(value: string): Cursor {
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw badCursor();
  }
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const decoded = atob(base64);
    const restored = btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    const parsed: unknown = JSON.parse(decoded);
    if (restored !== value || !parsed || typeof parsed !== 'object') throw badCursor();
    const row = parsed as Partial<Cursor>;
    if (!row.createdAt || !Number.isFinite(Date.parse(row.createdAt)) ||
        !UuidSchema.safeParse(row.id).success) throw badCursor();
    return { createdAt: row.createdAt, id: row.id! };
  } catch {
    throw badCursor();
  }
}

function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function vocabularyItems(request: Request, env: ApiEnv, userId: string): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    throw badCursor();
  }
  const cursor = url.searchParams.has('cursor') ? decodeCursor(url.searchParams.get('cursor') ?? '') : null;
  const limit = parseLimit(url.searchParams.get('limit'));
  if (cursor) {
    const known = await env.DB.prepare(`
      SELECT id FROM vocabulary_items
      WHERE id = ? AND user_id = ? AND created_at = ? AND deleted_at IS NULL
    `).bind(cursor.id, userId, cursor.createdAt).first<{ id: string }>();
    if (!known) throw badCursor();
  }
  const rows = await env.DB.prepare(`
    SELECT item.id, item.term, item.meaning_zh, item.source_sentence, item.status,
      item.created_at, COALESCE(progress.practice_count, 0) AS practice_count,
      COALESCE(progress.first_try_correct_count, 0) AS first_try_correct_count,
      COALESCE(progress.assisted_count, 0) AS assisted_count,
      progress.last_practiced_at
    FROM vocabulary_items AS item
    LEFT JOIN learning_progress AS progress ON progress.vocabulary_item_id = item.id
    WHERE item.user_id = ? AND item.deleted_at IS NULL
      AND (? IS NULL OR item.created_at < ? OR (item.created_at = ? AND item.id < ?))
    ORDER BY item.created_at DESC, item.id DESC
    LIMIT ?
  `).bind(userId, cursor?.createdAt ?? null, cursor?.createdAt ?? null,
    cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1).all<ItemRow>();
  const page = rows.results.slice(0, limit);
  const nextCursor = rows.results.length > limit
    ? encodeCursor({ createdAt: page[page.length - 1]!.created_at, id: page[page.length - 1]!.id })
    : null;
  return Response.json(VocabularyPageSchema.parse({
    items: page.map((row) => ({
      id: row.id,
      term: row.term,
      meaningZh: row.meaning_zh,
      sourceSentence: row.source_sentence,
      status: row.status,
      practiceCount: row.practice_count,
      firstTryCorrectCount: row.first_try_correct_count,
      assistedCount: row.assisted_count,
      lastPracticedAt: row.last_practiced_at,
    })),
    nextCursor,
  }));
}

async function wordContexts(env: ApiEnv, userId: string, wordId: string): Promise<Response> {
  if (!UuidSchema.safeParse(wordId).success) {
    throw new AppError('VALIDATION_ERROR', '单词格式无效', 400);
  }
  const rows = await env.DB.prepare(`
    SELECT id, meaning_zh, source_sentence
    FROM vocabulary_items
    WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).bind(userId, wordId).all<{
    id: string;
    meaning_zh: string;
    source_sentence: string | null;
  }>();
  if (rows.results.length === 0) throw new AppError('NOT_FOUND', '单词不存在', 404);
  return Response.json(VocabularyWordContextsSchema.parse({
    wordId,
    contexts: rows.results.map((row) => ({
      id: row.id,
      meaningZh: row.meaning_zh,
      sourceSentence: row.source_sentence,
    })),
  }));
}

export async function handleVocabularyReadRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const pathname = new URL(request.url).pathname;
  if (pathname === '/v1/vocabulary-items') return vocabularyItems(request, env, userId);
  const match = /^\/v1\/vocabulary-words\/([^/]+)\/contexts$/u.exec(pathname);
  if (match) {
    let wordId: string;
    try {
      wordId = decodeURIComponent(match[1]!);
    } catch {
      throw new AppError('VALIDATION_ERROR', '单词格式无效', 400);
    }
    return wordContexts(env, userId, wordId);
  }
  return null;
}

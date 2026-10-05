import {
  RenamedVocabularyWordSchema,
  RenameVocabularyWordRequestSchema,
  UpdateVocabularyContextRequestSchema,
  UuidSchema,
  VocabularyContextSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import {
  normalizeMeaningZh,
  normalizeTerm,
  vocabularyFingerprint,
} from '../../../../server/src/modules/vocabulary/normalize';
import { replayReviews } from '../../../../server/src/modules/vocabulary/scheduler';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1StatementBinding } from '../env';

// Deleting is a soft delete: earlier practices still show the meaning they practised, and the
// word keeps its answers, so its review state stays consistent with them. Correcting a meaning
// or example edits it in place. Correcting the spelling moves every meaning to the word for the
// new spelling (created when new, with its own review plan) and retires the old ones.

const WORD_PATH = /^\/v1\/vocabulary-words\/([^/]+)$/u;
const ITEM_PATH = /^\/v1\/vocabulary-items\/([^/]+)$/u;
const RENAME_OPERATION = 'rename_vocabulary_word';
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const owned = 'EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)';

interface ItemRow {
  id: string;
  term: string;
  meaningZh: string;
  sourceSentence: string | null;
  deletedAt: string | null;
}

const json = (body: unknown) => Response.json(body, { headers: { 'cache-control': 'no-store' } });
const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
const wordNotFound = () => new AppError('NOT_FOUND', '单词不存在或已删除', 404);
const itemNotFound = () => new AppError('NOT_FOUND', '释义不存在或已删除', 404);
const duplicate = () => new AppError('VOCABULARY_DUPLICATE', '这个单词已经有相同的释义', 409);

function resourceId(raw: string, notFound: () => AppError): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw notFound();
  }
  if (!UuidSchema.safeParse(decoded).success) throw notFound();
  return decoded;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function deleteWord(env: ApiEnv, userId: string, wordId: string): Promise<Response> {
  const word = await env.DB.prepare('SELECT id FROM vocabulary_words WHERE id = ? AND user_id = ?')
    .bind(wordId, userId).first<{ id: string }>();
  if (!word) throw wordNotFound();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE vocabulary_items SET deleted_at = ?, updated_at = ?
      WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL`).bind(now, now, userId, wordId),
    // Saving the word again later brings it back to learning instead of hidden as mastered.
    env.DB.prepare('UPDATE vocabulary_words SET mastered_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(now, wordId, userId),
  ]);
  return noContent();
}

async function loadItem(env: ApiEnv, userId: string, itemId: string): Promise<ItemRow | null> {
  return env.DB.prepare(`
    SELECT id, term, meaning_zh AS meaningZh, source_sentence AS sourceSentence, deleted_at AS deletedAt
    FROM vocabulary_items WHERE id = ? AND user_id = ?
  `).bind(itemId, userId).first<ItemRow>();
}

async function deleteItem(env: ApiEnv, userId: string, itemId: string): Promise<Response> {
  const item = await loadItem(env, userId, itemId);
  if (!item) throw itemNotFound();
  if (item.deletedAt === null) {
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE vocabulary_items SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).bind(now, now, itemId, userId).run();
  }
  return noContent();
}

async function updateItem(request: Request, env: ApiEnv, userId: string, itemId: string): Promise<Response> {
  const parsed = UpdateVocabularyContextRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请填写 1–200 字的中文释义', 400);
  const item = await loadItem(env, userId, itemId);
  if (!item || item.deletedAt !== null) throw itemNotFound();
  const { meaningZh, sourceSentence } = parsed.data;
  const fingerprint = vocabularyFingerprint(item.term, meaningZh);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`
      UPDATE vocabulary_items
      SET meaning_zh = ?, normalized_meaning_zh = ?, source_sentence = ?, fingerprint = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).bind(meaningZh, normalizeMeaningZh(meaningZh), sourceSentence, fingerprint, now, itemId, userId).run();
  } catch (error) {
    // The unique index on active meanings rejects a meaning the word already has.
    const taken = await env.DB.prepare(`SELECT id FROM vocabulary_items
      WHERE user_id = ? AND fingerprint = ? AND deleted_at IS NULL AND id <> ?`)
      .bind(userId, fingerprint, itemId).first();
    if (taken) throw duplicate();
    throw error;
  }
  const saved = await loadItem(env, userId, itemId);
  if (!saved || saved.deletedAt !== null) throw itemNotFound();
  return json(VocabularyContextSchema.parse({
    id: saved.id, meaningZh: saved.meaningZh, sourceSentence: saved.sourceSentence,
  }));
}

async function renameWord(request: Request, env: ApiEnv, userId: string, wordId: string): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key || !KEY_PATTERN.test(key)) throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  const parsed = RenameVocabularyWordRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请填写 1–80 个字符的单词', 400);
  const { term } = parsed.data;
  const normalized = normalizeTerm(term);
  const requestHash = await sha256Hex(JSON.stringify({ wordId, term }));

  const replay = async () => {
    const record = await env.DB.prepare(`SELECT request_hash AS requestHash, resource_id AS resourceId
      FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?`)
      .bind(userId, RENAME_OPERATION, key).first<{ requestHash: string; resourceId: string }>();
    if (record && record.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
    }
    return record ? json(RenamedVocabularyWordSchema.parse({ wordId: record.resourceId, term })) : null;
  };
  const replayed = await replay();
  if (replayed) return replayed;

  const word = await env.DB.prepare('SELECT normalized_term AS normalizedTerm FROM vocabulary_words WHERE id = ? AND user_id = ?')
    .bind(wordId, userId).first<{ normalizedTerm: string }>();
  if (!word) throw wordNotFound();
  const items = (await env.DB.prepare(`
    SELECT id, term, meaning_zh AS meaningZh, source_sentence AS sourceSentence, deleted_at AS deletedAt
    FROM vocabulary_items WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL
    ORDER BY created_at, id
  `).bind(userId, wordId).all<ItemRow>()).results;
  if (items.length === 0) throw wordNotFound();
  const now = new Date();
  const nowIso = now.toISOString();

  if (normalized === word.normalizedTerm) {
    // Only capitalisation or spacing changed: the same word and the same meanings.
    await env.DB.prepare(`UPDATE vocabulary_items SET term = ?, updated_at = ?
      WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL`).bind(term, nowIso, userId, wordId).run();
    return json(RenamedVocabularyWordSchema.parse({ wordId, term }));
  }

  const recordId = crypto.randomUUID();
  const guardId = crypto.randomUUID();
  const targetWord = '(SELECT id FROM vocabulary_words WHERE user_id = ? AND normalized_term = ?)';
  const statements: D1StatementBinding[] = [
    env.DB.prepare(`
      INSERT INTO idempotency_records
        (id, user_id, operation, idempotency_key, request_hash, resource_type, resource_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'vocabulary_word', ?, ?, ?)
      ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
    `).bind(recordId, userId, RENAME_OPERATION, key, requestHash, wordId, nowIso,
      new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()),
    env.DB.prepare(`
      INSERT INTO vocabulary_words (id, user_id, normalized_term, review_state, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${owned}
      ON CONFLICT(user_id, normalized_term) DO NOTHING
    `).bind(crypto.randomUUID(), userId, normalized, JSON.stringify(replayReviews([], now)), nowIso, nowIso, recordId),
    // A meaning the corrected spelling already has is merged rather than duplicated.
    ...items.map((item) => env.DB.prepare(`
      INSERT INTO vocabulary_items
        (id, user_id, term, word_id, normalized_term, meaning_zh, normalized_meaning_zh,
         source_sentence, fingerprint, status, created_at, updated_at)
      SELECT ?, ?, ?, ${targetWord}, ?, ?, ?, ?, ?, 'pending', ?, ?
      WHERE ${owned} AND EXISTS (SELECT 1 FROM vocabulary_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL)
      ON CONFLICT DO NOTHING
    `).bind(crypto.randomUUID(), userId, term, userId, normalized, normalized, item.meaningZh,
      normalizeMeaningZh(item.meaningZh), item.sourceSentence, vocabularyFingerprint(term, item.meaningZh),
      nowIso, nowIso, recordId, item.id, userId)),
    env.DB.prepare(`
      UPDATE vocabulary_items SET deleted_at = ?, updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL AND id IN (${items.map(() => '?').join(', ')}) AND ${owned}
    `).bind(nowIso, nowIso, userId, ...items.map((item) => item.id), recordId),
    env.DB.prepare(`UPDATE idempotency_records SET resource_id = ${targetWord} WHERE id = ?`)
      .bind(userId, normalized, recordId),
    // Every meaning must have reached the corrected word, or the whole batch rolls back.
    env.DB.prepare(`
      INSERT INTO transaction_guards (id, valid)
      SELECT ?, CASE WHEN NOT ${owned} OR (
        NOT EXISTS (SELECT 1 FROM vocabulary_items WHERE user_id = ? AND word_id = ? AND deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM vocabulary_items WHERE user_id = ? AND word_id = ${targetWord} AND deleted_at IS NULL)
      ) THEN 1 ELSE 0 END
    `).bind(guardId, recordId, userId, wordId, userId, userId, normalized),
    env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
  ];
  try {
    await env.DB.batch(statements);
  } catch {
    const raced = await replay();
    if (raced) return raced;
    throw new AppError('STATE_CONFLICT', '单词刚刚发生变化，请刷新后重试', 409, true);
  }
  const result = await replay();
  if (!result) throw new AppError('DATABASE_UNAVAILABLE', '单词修改暂时不可用，请重试', 503, true);
  return result;
}

/** Corrects or deletes saved words and meanings. */
export async function handleVocabularyManageRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const word = WORD_PATH.exec(pathname);
  if (word && (request.method === 'DELETE' || request.method === 'PATCH')) {
    const wordId = resourceId(word[1]!, wordNotFound);
    return request.method === 'DELETE' ? deleteWord(env, userId, wordId) : renameWord(request, env, userId, wordId);
  }
  const item = ITEM_PATH.exec(pathname);
  if (item && (request.method === 'DELETE' || request.method === 'PATCH')) {
    const itemId = resourceId(item[1]!, itemNotFound);
    return request.method === 'DELETE' ? deleteItem(env, userId, itemId) : updateItem(request, env, userId, itemId);
  }
  return null;
}

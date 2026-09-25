import {
  VocabularyInputSchema,
  VocabularyItemDtoSchema,
  type VocabularyInput,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { replayReviews, REVIEW_MODEL_VERSION } from '../../../../server/src/modules/vocabulary/scheduler';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';

const PATH = '/v1/vocabulary-items';
const OPERATION = 'create_vocabulary_item';
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface IdRow {
  id: string;
}

interface IdempotencyRow {
  id: string;
  requestHash: string;
  resourceType: string;
  resourceId: string;
}

interface ItemRow {
  id: string;
  term: string;
  meaningZh: string;
  sourceSentence: string | null;
  status: string;
  practiceCount: number;
  firstTryCorrectCount: number;
  assistedCount: number;
  lastPracticedAt: string | null;
}

function batchRows<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('results' in result) ||
      !Array.isArray(result.results)) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时无法访问', 503, true);
  }
  return result.results as T[];
}

function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return key;
}

function collapseWhitespace(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function normalizeTerm(value: string): string {
  return collapseWhitespace(value).toLocaleLowerCase('en-US');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalRequest(item: VocabularyInput): string {
  // Mirrors the server idempotency service's sorted-key JSON encoding.
  return JSON.stringify(Object.fromEntries(
    Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  ));
}

function isoOrNull(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AppError('INTERNAL_ERROR', '词义状态需要修复', 500);
  }
  return date.toISOString();
}

export async function handleVocabularyCreateRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== PATH) return null;

  // Preserve the Fastify route's validation order: key, then body contract.
  const key = requireIdempotencyKey(request);
  const parsed = VocabularyInputSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '词义格式无效', 400);
  const item = parsed.data;
  const normalizedTerm = normalizeTerm(item.term);
  const normalizedMeaningZh = collapseWhitespace(item.meaningZh);
  const [requestHash, fingerprint] = await Promise.all([
    sha256Hex(canonicalRequest(item)),
    sha256Hex(`${normalizedTerm}\u0000${normalizedMeaningZh}`),
  ]);

  const recordId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const wordId = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  const emptyReviewState = JSON.stringify(replayReviews([], now));

  // D1 batch is one transaction. Only the invocation that inserted its own
  // idempotency record may create or relink data. The final UPDATE must find
  // a valid active item; its NOT NULL resource_id rolls the batch back if a
  // legacy or incomplete word projection cannot be safely repaired here.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO idempotency_records (
        id, user_id, operation, idempotency_key, request_hash,
        resource_type, resource_id, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'vocabulary_item', ?, ?, ?)
      ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
      RETURNING id
    `).bind(recordId, userId, OPERATION, key, requestHash, itemId, createdAt, expiresAt),
    env.DB.prepare(`
      INSERT INTO vocabulary_words (
        id, user_id, normalized_term, review_state, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM vocabulary_items WHERE user_id = ? AND normalized_term = ?
        )
      ON CONFLICT(user_id, normalized_term) DO NOTHING
    `).bind(wordId, userId, normalizedTerm, emptyReviewState, createdAt, createdAt,
      recordId, userId, normalizedTerm),
    env.DB.prepare(`
      INSERT INTO vocabulary_items (
        id, user_id, term, word_id, normalized_term, meaning_zh,
        normalized_meaning_zh, source_sentence, fingerprint, status,
        created_at, updated_at
      )
      SELECT ?, ?, ?, word.id, ?, ?, ?, ?, ?, 'pending', ?, ?
      FROM vocabulary_words AS word
      WHERE word.user_id = ? AND word.normalized_term = ?
        AND word.review_state IS NOT NULL
        AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      ON CONFLICT DO NOTHING
    `).bind(itemId, userId, item.term, normalizedTerm, item.meaningZh,
      normalizedMeaningZh, item.sourceSentence ?? null, fingerprint,
      createdAt, createdAt, userId, normalizedTerm, recordId),
    env.DB.prepare(`
      UPDATE vocabulary_items
      SET word_id = (
        SELECT id FROM vocabulary_words
        WHERE user_id = ? AND normalized_term = ?
      )
      WHERE user_id = ? AND normalized_term = ?
        AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        AND EXISTS (
          SELECT 1 FROM vocabulary_words
          WHERE user_id = ? AND normalized_term = ?
        )
        AND (word_id IS NULL OR word_id <> (
          SELECT id FROM vocabulary_words
          WHERE user_id = ? AND normalized_term = ?
        ))
    `).bind(userId, normalizedTerm, userId, normalizedTerm, recordId,
      userId, normalizedTerm, userId, normalizedTerm),
    env.DB.prepare(`
      UPDATE idempotency_records
      SET resource_id = (
        SELECT item.id
        FROM vocabulary_items AS item
        JOIN vocabulary_words AS word
          ON word.id = item.word_id AND word.user_id = item.user_id
          AND word.normalized_term = item.normalized_term
        WHERE item.user_id = ? AND item.fingerprint = ?
          AND item.deleted_at IS NULL
          AND word.review_state IS NOT NULL
          AND json_type(word.review_state, '$.version') = 'integer'
          AND json_extract(word.review_state, '$.version') = ?
          AND json_type(word.review_state, '$.answerCount') = 'integer'
          AND json_extract(word.review_state, '$.answerCount') = (
            SELECT COUNT(*)
            FROM answer_attempts AS answer
            JOIN practice_questions AS question
              ON question.id = answer.practice_question_id
            JOIN practice_targets AS target
              ON target.id = question.practice_target_id
            JOIN vocabulary_items AS context
              ON context.id = target.vocabulary_item_id
            WHERE answer.user_id = item.user_id
              AND context.user_id = item.user_id
              AND context.word_id = word.id
          )
        LIMIT 1
      )
      WHERE id = ? AND user_id = ? AND operation = ?
      RETURNING resource_id AS resourceId
    `).bind(userId, fingerprint, REVIEW_MODEL_VERSION, recordId, userId, OPERATION),
    env.DB.prepare(`
      SELECT id, request_hash AS requestHash, resource_type AS resourceType,
             resource_id AS resourceId
      FROM idempotency_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(userId, OPERATION, key),
    env.DB.prepare(`
      SELECT item.id, item.term, item.meaning_zh AS meaningZh,
             item.source_sentence AS sourceSentence, item.status,
             COALESCE(progress.practice_count, 0) AS practiceCount,
             COALESCE(progress.first_try_correct_count, 0) AS firstTryCorrectCount,
             COALESCE(progress.assisted_count, 0) AS assistedCount,
             progress.last_practiced_at AS lastPracticedAt
      FROM idempotency_records AS record
      JOIN vocabulary_items AS item ON item.id = record.resource_id
        AND item.user_id = record.user_id AND item.deleted_at IS NULL
      LEFT JOIN learning_progress AS progress ON progress.vocabulary_item_id = item.id
      WHERE record.user_id = ? AND record.operation = ?
        AND record.idempotency_key = ?
      LIMIT 1
    `).bind(userId, OPERATION, key),
  ]);

  if (results.length !== 7) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时无法访问', 503, true);
  }
  const claimed = batchRows<IdRow>(results[0]);
  const finalized = batchRows<{ resourceId: string }>(results[4]);
  const record = batchRows<IdempotencyRow>(results[5])[0];
  const saved = batchRows<ItemRow>(results[6])[0];
  if (record && record.requestHash !== requestHash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (!record || record.resourceType !== 'vocabulary_item') {
    throw new AppError('INTERNAL_ERROR', '词义保存失败', 500, true);
  }
  if (claimed.length === 1 &&
      (claimed[0]?.id !== recordId || finalized[0]?.resourceId !== record.resourceId)) {
    throw new AppError('INTERNAL_ERROR', '词义保存失败', 500, true);
  }
  if (claimed.length === 0 && finalized.length !== 0) {
    throw new AppError('INTERNAL_ERROR', '词义保存失败', 500, true);
  }
  if (!saved) throw new AppError('NOT_FOUND', '词义不存在', 404);
  if (saved.id !== record.resourceId) {
    throw new AppError('INTERNAL_ERROR', '词义保存失败', 500, true);
  }

  return Response.json(VocabularyItemDtoSchema.parse({
    id: saved.id,
    term: saved.term,
    meaningZh: saved.meaningZh,
    sourceSentence: saved.sourceSentence,
    status: saved.status,
    practiceCount: saved.practiceCount,
    firstTryCorrectCount: saved.firstTryCorrectCount,
    assistedCount: saved.assistedCount,
    lastPracticedAt: isoOrNull(saved.lastPracticedAt),
  }), { status: 201, headers: { 'Cache-Control': 'no-store' } });
}

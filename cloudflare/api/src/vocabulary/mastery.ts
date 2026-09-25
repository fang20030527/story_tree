import {
  UuidSchema,
  VocabularyWordMasterySchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

const MASTERY_PATH = /^\/v1\/vocabulary-words\/([^/]+)\/(mastered|unmaster)$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
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

interface WordRow {
  id: string;
  masteredAt: string | null;
}

function rows<T>(result: unknown): T[] {
  if (typeof result !== 'object' || result === null || !('results' in result)) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }
  const value = result.results;
  if (!Array.isArray(value)) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }
  return value as T[];
}

function parseWordId(rawWordId: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawWordId);
  } catch {
    throw new AppError('VALIDATION_ERROR', '单词格式无效', 400);
  }
  if (!UuidSchema.safeParse(decoded).success) {
    throw new AppError('VALIDATION_ERROR', '单词格式无效', 400);
  }
  return decoded;
}

function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return key;
}

async function requestHash(wordId: string): Promise<string> {
  // The existing idempotency service hashes canonical JSON. A single-key
  // object has the same canonical encoding as JSON.stringify here.
  const bytes = new TextEncoder().encode(JSON.stringify({ wordId }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleVocabularyMasteryRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const match = MASTERY_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;

  const wordId = parseWordId(match[1] ?? '');
  const mastered = match[2] === 'mastered';
  const operation = mastered ? 'mark_vocabulary_word_mastered' : 'restore_vocabulary_word';
  const key = requireIdempotencyKey(request);
  const hash = await requestHash(wordId);
  const recordId = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();

  // D1 batch executes these statements in one transaction. The insert owns
  // this request key only if the word exists; only its new record ID can
  // authorize the UPDATE. A concurrent retry or conflicting request cannot
  // advance mastered_at or updated_at.
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO idempotency_records (
        id, user_id, operation, idempotency_key, request_hash,
        resource_type, resource_id, created_at, expires_at
      )
      SELECT ?, ?, ?, ?, ?, 'vocabulary_word', ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM vocabulary_words WHERE id = ? AND user_id = ?
      )
      ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
      RETURNING id
    `).bind(recordId, userId, operation, key, hash, wordId, createdAt, expiresAt, wordId, userId),
    env.DB.prepare(`
      UPDATE vocabulary_words
      SET mastered_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
        AND EXISTS (
          SELECT 1 FROM idempotency_records
          WHERE id = ? AND user_id = ? AND operation = ?
            AND idempotency_key = ? AND request_hash = ? AND resource_id = ?
        )
      RETURNING id, mastered_at AS masteredAt
    `).bind(mastered ? createdAt : null, createdAt, wordId, userId,
      recordId, userId, operation, key, hash, wordId),
    env.DB.prepare(`
      SELECT id, request_hash AS requestHash, resource_type AS resourceType,
             resource_id AS resourceId
      FROM idempotency_records
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(userId, operation, key),
    env.DB.prepare(`
      SELECT id, mastered_at AS masteredAt
      FROM vocabulary_words WHERE id = ? AND user_id = ? LIMIT 1
    `).bind(wordId, userId),
  ]);

  if (results.length !== 4) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }
  const inserted = rows<IdRow>(results[0]);
  const updated = rows<WordRow>(results[1]);
  const records = rows<IdempotencyRow>(results[2]);
  const words = rows<WordRow>(results[3]);
  const record = records[0];
  if (record && record.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (!words[0]) throw new AppError('NOT_FOUND', '单词不存在', 404);
  if (!record || record.resourceType !== 'vocabulary_word' || record.resourceId !== wordId) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }
  if (inserted.length === 1 && (inserted[0]?.id !== recordId || updated.length !== 1)) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }
  if (inserted.length === 0 && updated.length !== 0) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }

  const payload = VocabularyWordMasterySchema.parse({
    wordId,
    masteredAt: words[0].masteredAt,
  });
  return Response.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

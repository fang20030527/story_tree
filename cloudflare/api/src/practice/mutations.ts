import {
  AnswerResultSchema,
  AssistanceRequestSchema,
  AssistanceResponseSchema,
  SubmitAnswerRequestSchema,
  UuidSchema,
  type AssistanceRequest,
  type AssistanceResponse,
  type SubmitAnswerRequest,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { submitAnswerOnCpuBoundary } from '../cpu/client';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1DatabaseBinding } from '../env';

const MUTATION_PATH = /^\/v1\/practices\/([^/]+)\/(assistance|answers)$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface IdRow { id: string }
interface PracticeRow { status: string }
interface IdempotencyRow {
  requestHash: string;
  resourceType: string;
  resourceId: string;
}
interface AssistanceRow {
  kind: AssistanceRequest['kind'];
  practiceTargetId: string | null;
  hintMeaningZh: string | null;
  sourceSentence: string | null;
}
interface AnswerReplayRow {
  answerKind: 'option' | 'dont_know';
  selectedOptionId: string | null;
  isCorrect: number;
  wasAssisted: number;
  correctOptionId: string;
  meaningEn: string;
  explanationZh: string;
  optionExplanationsJson: string;
}

function databaseUnavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
}

function batchRows<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('results' in result) ||
      !Array.isArray(result.results)) {
    throw databaseUnavailable();
  }
  return result.results as T[];
}

function parsePracticeId(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', '练习编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(decoded).success) {
    throw new AppError('VALIDATION_ERROR', '练习编号格式无效', 400);
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

async function hashRequest(material: unknown): Promise<string> {
  const serialized = JSON.stringify(canonicalize(material)) ?? 'undefined';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handlePracticeMutationRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const match = MUTATION_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;

  const practiceId = parsePracticeId(match[1]!);
  const idempotencyKey = requireIdempotencyKey(request);
  if (match[2] === 'answers') {
    const parsed = SubmitAnswerRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请检查答题内容', 400);
    }
    const replay = await replayExistingAnswer(env.DB, {
      userId, practiceId, idempotencyKey, request: parsed.data,
    });
    if (replay) return replay;
    const requestHash = await hashRequest({ practiceId, ...parsed.data });
    const answer = await submitAnswerOnCpuBoundary(env, {
      userId, practiceId, idempotencyKey, requestHash, request: parsed.data,
    });
    return Response.json(AnswerResultSchema.parse(answer), {
      headers: { 'cache-control': 'no-store' },
    });
  }

  const parsed = AssistanceRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '请检查辅助请求', 400);
  }
  const body = await recordAssistance(env.DB, {
    userId, practiceId, idempotencyKey, request: parsed.data,
  });
  return Response.json(AssistanceResponseSchema.parse(body), {
    headers: { 'cache-control': 'no-store' },
  });
}

/** Historical successful requests can be replayed without any D1 mutation. */
async function replayExistingAnswer(
  db: D1DatabaseBinding,
  input: {
    userId: string;
    practiceId: string;
    idempotencyKey: string;
    request: SubmitAnswerRequest;
  },
): Promise<Response | null> {
  const hash = await hashRequest({ practiceId: input.practiceId, ...input.request });
  const record = await db.prepare(`
    SELECT request_hash AS requestHash, resource_type AS resourceType,
           resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = 'submit_answer'
      AND idempotency_key = ? LIMIT 1
  `).bind(input.userId, input.idempotencyKey).first<IdempotencyRow>();
  if (!record) return null;
  if (record.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (record.resourceType !== 'answer') throw databaseUnavailable();

  const row = await db.prepare(`
    SELECT answer.answer_kind AS answerKind,
           answer.selected_option_id AS selectedOptionId,
           answer.is_correct AS isCorrect,
           answer.was_assisted AS wasAssisted,
           question.correct_option_id AS correctOptionId,
           question.meaning_en AS meaningEn,
           question.explanation_zh AS explanationZh,
           question.option_explanations_json AS optionExplanationsJson
    FROM answer_attempts AS answer
    JOIN practice_questions AS question
      ON question.id = answer.practice_question_id
    JOIN practice_targets AS target
      ON target.id = question.practice_target_id
    JOIN practice_sessions AS practice
      ON practice.id = answer.practice_session_id
    WHERE answer.id = ? AND answer.user_id = ?
      AND answer.practice_session_id = ?
      AND target.practice_session_id = ?
      AND practice.user_id = ?
    LIMIT 1
  `).bind(record.resourceId, input.userId, input.practiceId,
    input.practiceId, input.userId).first<AnswerReplayRow>();
  if (!row) throw new AppError('NOT_FOUND', '答案不存在', 404);
  if ((row.isCorrect !== 0 && row.isCorrect !== 1) ||
      (row.wasAssisted !== 0 && row.wasAssisted !== 1)) {
    throw databaseUnavailable();
  }
  let optionExplanations: unknown;
  try {
    optionExplanations = JSON.parse(row.optionExplanationsJson);
  } catch {
    throw databaseUnavailable();
  }
  const feedback = {
    wasAssisted: row.wasAssisted === 1,
    correctOptionId: row.correctOptionId,
    meaningEn: row.meaningEn,
    explanationZh: row.explanationZh,
    optionExplanations,
  };
  const body = AnswerResultSchema.parse(row.answerKind === 'dont_know' ? {
    answerKind: 'dont_know', selectedOptionId: null, isCorrect: false,
    ...feedback,
  } : {
    answerKind: 'option', selectedOptionId: row.selectedOptionId,
    isCorrect: row.isCorrect === 1,
    ...feedback,
  });
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}

async function recordAssistance(
  db: D1DatabaseBinding,
  input: {
    userId: string;
    practiceId: string;
    idempotencyKey: string;
    request: AssistanceRequest;
  },
): Promise<AssistanceResponse> {
  const { userId, practiceId, idempotencyKey, request } = input;
  const requestHash = await hashRequest({ practiceId, ...request });
  const assistanceId = crypto.randomUUID();
  const idempotencyId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  const targetId = request.kind === 'word_hint' ? request.targetId : null;
  const paragraphId = request.kind === 'paragraph_translation' ? request.paragraphId : null;

  // D1 batch executes atomically. A newly inserted event is the gate for every
  // later write; replay or a conflicting key cannot advance the practice.
  const batch = await db.batch([
    db.prepare(`
      INSERT INTO assistance_events (
        id, practice_session_id, user_id, kind, practice_target_id,
        paragraph_id, idempotency_key, shown_at
      )
      SELECT ?1, practice.id, ?2, ?3, ?4, ?5, ?6, ${DB_NOW}
      FROM practice_sessions AS practice
      WHERE practice.id = ?7 AND practice.user_id = ?2
        AND practice.status IN ('ready', 'in_progress', 'completed')
        AND (
          ?3 = 'full_translation'
          OR (?3 = 'word_hint' AND EXISTS (
            SELECT 1 FROM practice_targets AS target
            JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
            WHERE target.id = ?4 AND target.practice_session_id = practice.id
          ))
          OR (?3 = 'paragraph_translation' AND EXISTS (
            SELECT 1 FROM practice_paragraphs AS paragraph
            WHERE paragraph.id = ?5 AND paragraph.practice_session_id = practice.id
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM idempotency_records AS record
          WHERE record.user_id = ?2 AND record.operation = 'record_assistance'
            AND record.idempotency_key = ?6
        )
      ON CONFLICT(user_id, practice_session_id, idempotency_key) DO NOTHING
      RETURNING id
    `).bind(assistanceId, userId, request.kind, targetId, paragraphId,
      idempotencyKey, practiceId),
    db.prepare(`
      UPDATE practice_sessions
      SET status = 'in_progress',
        started_at = COALESCE(started_at, (
          SELECT shown_at FROM assistance_events WHERE id = ?1
        ))
      WHERE id = ?2 AND user_id = ?3 AND status = 'ready'
        AND EXISTS (SELECT 1 FROM assistance_events WHERE id = ?1)
      RETURNING id
    `).bind(assistanceId, practiceId, userId),
    db.prepare(`
      INSERT INTO idempotency_records (
        id, user_id, operation, idempotency_key, request_hash,
        resource_type, resource_id, created_at, expires_at
      )
      SELECT ?1, ?2, 'record_assistance', ?3, ?4,
        'assistance', event.id, ?5, ?6
      FROM assistance_events AS event
      WHERE event.id = ?7 AND event.user_id = ?2
        AND event.practice_session_id = ?8
      RETURNING id
    `).bind(idempotencyId, userId, idempotencyKey, requestHash,
      now.toISOString(), expiresAt, assistanceId, practiceId),
    db.prepare(`
      SELECT request_hash AS requestHash, resource_type AS resourceType,
        resource_id AS resourceId
      FROM idempotency_records
      WHERE user_id = ?1 AND operation = 'record_assistance'
        AND idempotency_key = ?2 LIMIT 1
    `).bind(userId, idempotencyKey),
    db.prepare(`
      SELECT event.kind, event.practice_target_id AS practiceTargetId,
        item.meaning_zh AS hintMeaningZh,
        item.source_sentence AS sourceSentence
      FROM idempotency_records AS record
      JOIN assistance_events AS event ON event.id = record.resource_id
      LEFT JOIN practice_targets AS target ON target.id = event.practice_target_id
      LEFT JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
      WHERE record.user_id = ?1 AND record.operation = 'record_assistance'
        AND record.idempotency_key = ?2 AND record.resource_type = 'assistance'
        AND event.user_id = ?1 AND event.practice_session_id = ?3
      LIMIT 1
    `).bind(userId, idempotencyKey, practiceId),
  ]);
  if (batch.length !== 5) throw databaseUnavailable();
  const inserted = batchRows<IdRow>(batch[0]);
  const updated = batchRows<IdRow>(batch[1]);
  const recorded = batchRows<IdRow>(batch[2]);
  const idempotency = batchRows<IdempotencyRow>(batch[3])[0];
  const event = batchRows<AssistanceRow>(batch[4])[0];

  if (idempotency && idempotency.requestHash !== requestHash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (!idempotency) {
    await classifyRejectedAssistance(db, input);
    throw databaseUnavailable();
  }
  if (idempotency.resourceType !== 'assistance') throw databaseUnavailable();
  if (!event) throw new AppError('NOT_FOUND', '辅助记录不存在', 404);
  if (inserted.length === 1 &&
      (inserted[0]?.id !== assistanceId || recorded[0]?.id !== idempotencyId ||
       idempotency.resourceId !== assistanceId)) {
    throw databaseUnavailable();
  }
  if (inserted.length === 0 && (updated.length !== 0 || recorded.length !== 0)) {
    throw databaseUnavailable();
  }
  if (event.kind === 'word_hint' &&
      (!event.practiceTargetId || event.hintMeaningZh === null)) {
    throw new AppError('INTERNAL_ERROR', '辅助记录暂时无法读取', 500, true);
  }
  return AssistanceResponseSchema.parse({
    recorded: true,
    hintMeaningZh: event.kind === 'word_hint' ? event.hintMeaningZh : null,
    ...(event.kind === 'word_hint' ? { sourceSentence: event.sourceSentence } : {}),
  });
}

async function classifyRejectedAssistance(
  db: D1DatabaseBinding,
  input: {
    userId: string;
    practiceId: string;
    request: AssistanceRequest;
  },
): Promise<void> {
  const practice = await db.prepare(`
    SELECT status FROM practice_sessions WHERE id = ? AND user_id = ? LIMIT 1
  `).bind(input.practiceId, input.userId).first<PracticeRow>();
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  if (!['ready', 'in_progress', 'completed'].includes(practice.status)) {
    throw new AppError('STATE_CONFLICT', '练习尚不能记录辅助', 409);
  }
  if (input.request.kind === 'word_hint') {
    const target = await db.prepare(`
      SELECT target.id FROM practice_targets AS target
      JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
      WHERE target.id = ? AND target.practice_session_id = ? LIMIT 1
    `).bind(input.request.targetId, input.practiceId).first<IdRow>();
    if (!target) throw new AppError('NOT_FOUND', '目标词不存在', 404);
  } else if (input.request.kind === 'paragraph_translation') {
    const paragraph = await db.prepare(`
      SELECT id FROM practice_paragraphs
      WHERE id = ? AND practice_session_id = ? LIMIT 1
    `).bind(input.request.paragraphId, input.practiceId).first<IdRow>();
    if (!paragraph) throw new AppError('NOT_FOUND', '段落不存在', 404);
  }
}

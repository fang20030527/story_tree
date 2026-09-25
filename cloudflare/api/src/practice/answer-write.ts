import {
  AnswerResultSchema,
  type AnswerResult,
  type SubmitAnswerRequest,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import {
  consolidateReviews, replayReviews,
  type ReviewEvidence,
} from '../../../../server/src/modules/vocabulary/scheduler';
import type { D1DatabaseBinding, D1StatementBinding } from '../env';

const DB_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CONFLICT_RETRIES = 3;

interface QuestionRow {
  questionId: string;
  targetId: string;
  itemId: string;
  wordId: string | null;
  wordCreatedAt: string | null;
  reviewState: string | null;
  status: string;
  optionsJson: string;
  correctOptionId: string;
  meaningEn: string;
  explanationZh: string;
  optionExplanationsJson: string;
  paragraphId: string | null;
}

interface EvidenceRow {
  answerId: string;
  practiceId: string;
  vocabularyItemId: string;
  submittedAt: string;
  isCorrect: number;
  wasAssisted: number;
  wordHint: number;
}

interface AssistRow { wasAssisted: number; wordHint: number }
interface ExistingAnswerRow {
  id: string;
  answerKind: 'option' | 'dont_know';
  selectedOptionId: string | null;
  isCorrect: number;
  wasAssisted: number;
}
interface IdempotencyRow {
  requestHash: string;
  resourceId: string;
  resourceType: string;
}

export interface AnswerSubmission {
  userId: string;
  practiceId: string;
  request: SubmitAnswerRequest;
  idempotencyKey: string;
  requestHash: string;
}

function unavailable(): AppError {
  return new AppError('DATABASE_UNAVAILABLE', '答题服务暂时不可用', 503, true);
}

function conflict(): AppError {
  return new AppError('STATE_CONFLICT', '答题状态已变更，请重试', 409, true);
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw unavailable(); }
}

function answerResult(
  answer: ExistingAnswerRow,
  question: QuestionRow,
): AnswerResult {
  const feedback = {
    wasAssisted: answer.wasAssisted === 1,
    correctOptionId: question.correctOptionId,
    meaningEn: question.meaningEn,
    explanationZh: question.explanationZh,
    optionExplanations: parseJson(question.optionExplanationsJson),
  };
  return AnswerResultSchema.parse(answer.answerKind === 'dont_know'
    ? { answerKind: 'dont_know', selectedOptionId: null, isCorrect: false, ...feedback }
    : {
      answerKind: 'option', selectedOptionId: answer.selectedOptionId,
      isCorrect: answer.isCorrect === 1, ...feedback,
    });
}

async function loadQuestion(
  db: D1DatabaseBinding, userId: string, practiceId: string, questionId: string,
): Promise<QuestionRow> {
  const row = await db.prepare(`
    SELECT question.id AS questionId, target.id AS targetId,
      item.id AS itemId, item.word_id AS wordId,
      word.created_at AS wordCreatedAt, word.review_state AS reviewState,
      practice.status, question.options_json AS optionsJson,
      question.correct_option_id AS correctOptionId,
      question.meaning_en AS meaningEn,
      question.explanation_zh AS explanationZh,
      question.option_explanations_json AS optionExplanationsJson,
      target.paragraph_id AS paragraphId
    FROM practice_sessions AS practice
    JOIN practice_targets AS target ON target.practice_session_id = practice.id
    JOIN practice_questions AS question ON question.practice_target_id = target.id
    JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
    LEFT JOIN vocabulary_words AS word ON word.id = item.word_id AND word.user_id = item.user_id
    WHERE practice.id = ? AND practice.user_id = ? AND question.id = ?
      AND item.user_id = ?
    LIMIT 1
  `).bind(practiceId, userId, questionId, userId).first<QuestionRow>();
  if (!row) throw new AppError('NOT_FOUND', '题目不存在', 404);
  return row;
}

async function findRecord(
  db: D1DatabaseBinding, userId: string, key: string,
): Promise<IdempotencyRow | null> {
  return db.prepare(`
    SELECT request_hash AS requestHash, resource_id AS resourceId,
      resource_type AS resourceType
    FROM idempotency_records WHERE user_id = ? AND operation = 'submit_answer'
      AND idempotency_key = ? LIMIT 1
  `).bind(userId, key).first<IdempotencyRow>();
}

async function existingAnswer(
  db: D1DatabaseBinding, userId: string, questionId: string,
): Promise<ExistingAnswerRow | null> {
  return db.prepare(`
    SELECT id, answer_kind AS answerKind, selected_option_id AS selectedOptionId,
      is_correct AS isCorrect, was_assisted AS wasAssisted
    FROM answer_attempts WHERE user_id = ? AND practice_question_id = ? LIMIT 1
  `).bind(userId, questionId).first<ExistingAnswerRow>();
}

function assertMatchingRecord(row: IdempotencyRow, hash: string): void {
  if (row.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (row.resourceType !== 'answer') throw unavailable();
}

async function priorAssistance(
  db: D1DatabaseBinding,
  input: AnswerSubmission,
  question: QuestionRow,
  submittedAt: string,
): Promise<AssistRow> {
  const row = await db.prepare(`
    SELECT
      EXISTS (SELECT 1 FROM assistance_events AS help
        WHERE help.user_id = ? AND help.practice_session_id = ?
          AND help.shown_at <= ? AND
          ((help.kind = 'word_hint' AND help.practice_target_id = ?)
           OR (help.kind = 'paragraph_translation' AND help.paragraph_id = ?)
           OR help.kind = 'full_translation')) AS wasAssisted,
      EXISTS (SELECT 1 FROM assistance_events AS hint
        WHERE hint.user_id = ? AND hint.practice_session_id = ?
          AND hint.shown_at <= ? AND hint.kind = 'word_hint'
          AND hint.practice_target_id = ?) AS wordHint
  `).bind(input.userId, input.practiceId, submittedAt,
    question.targetId, question.paragraphId, input.userId, input.practiceId,
    submittedAt, question.targetId).first<AssistRow>();
  if (!row || ![0, 1].includes(row.wasAssisted) || ![0, 1].includes(row.wordHint)) {
    throw unavailable();
  }
  return row;
}

async function loadEvidence(
  db: D1DatabaseBinding, userId: string, wordId: string,
): Promise<ReviewEvidence[]> {
  const rows = await db.prepare(`
    SELECT answer.id AS answerId, answer.practice_session_id AS practiceId,
      target.vocabulary_item_id AS vocabularyItemId,
      answer.submitted_at AS submittedAt, answer.is_correct AS isCorrect,
      answer.was_assisted AS wasAssisted,
      EXISTS (SELECT 1 FROM assistance_events AS hint
        WHERE hint.user_id = answer.user_id
          AND hint.practice_session_id = answer.practice_session_id
          AND hint.practice_target_id = target.id AND hint.kind = 'word_hint'
          AND hint.shown_at <= answer.submitted_at) AS wordHint
    FROM answer_attempts AS answer
    JOIN practice_questions AS question ON question.id = answer.practice_question_id
    JOIN practice_targets AS target ON target.id = question.practice_target_id
    JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
    WHERE answer.user_id = ? AND item.user_id = ? AND item.word_id = ?
  `).bind(userId, userId, wordId).all<EvidenceRow>();
  return rows.results.map((row) => {
    const submittedAt = new Date(row.submittedAt);
    if (!Number.isFinite(submittedAt.getTime()) ||
        ![0, 1].includes(row.isCorrect) || ![0, 1].includes(row.wasAssisted) ||
        ![0, 1].includes(row.wordHint)) throw unavailable();
    return {
      answerId: row.answerId,
      practiceId: row.practiceId,
      vocabularyItemId: row.vocabularyItemId,
      submittedAt,
      isCorrect: row.isCorrect === 1,
      wasAssisted: row.wasAssisted === 1,
      wordHint: row.wordHint === 1,
    };
  });
}

async function attachIdempotencyToExisting(
  db: D1DatabaseBinding, input: AnswerSubmission, answerId: string,
): Promise<void> {
  const now = new Date();
  await db.prepare(`
    INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, request_hash,
       resource_type, resource_id, created_at, expires_at)
    VALUES (?, ?, 'submit_answer', ?, ?, 'answer', ?, ?, ?)
    ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
  `).bind(crypto.randomUUID(), input.userId, input.idempotencyKey,
    input.requestHash, answerId, now.toISOString(),
    new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()).run();
  const record = await findRecord(db, input.userId, input.idempotencyKey);
  if (!record) throw unavailable();
  assertMatchingRecord(record, input.requestHash);
  if (record.resourceId !== answerId) throw unavailable();
}

function grade(input: SubmitAnswerRequest, question: QuestionRow): {
  selectedOptionId: string | null; isCorrect: boolean;
} {
  if (input.answerKind === 'dont_know') {
    return { selectedOptionId: null, isCorrect: false };
  }
  const options = parseJson(question.optionsJson);
  if (!Array.isArray(options) || !options.some((option: unknown) =>
    typeof option === 'object' && option !== null && 'id' in option &&
      option.id === input.selectedOptionId)) {
    throw new AppError('VALIDATION_ERROR', '所选答案无效', 400);
  }
  return {
    selectedOptionId: input.selectedOptionId,
    isCorrect: input.selectedOptionId === question.correctOptionId,
  };
}

function guard(
  db: D1DatabaseBinding, guardId: string, input: AnswerSubmission,
  question: QuestionRow, oldAnswerCount: number, assisted: AssistRow,
  submittedAt: string,
): D1StatementBinding {
  // A failed CHECK aborts every write in the D1 batch. The review-state and
  // evidence-count predicates detect competing answer/vocabulary writers.
  return db.prepare(`
    INSERT INTO transaction_guards (id, valid)
    VALUES (?, CASE WHEN EXISTS (
      SELECT 1 FROM practice_sessions AS practice
      JOIN practice_targets AS target ON target.practice_session_id = practice.id
      JOIN practice_questions AS question ON question.practice_target_id = target.id
      JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
      JOIN vocabulary_words AS word ON word.id = item.word_id
      WHERE practice.id = ? AND practice.user_id = ?
        AND practice.status IN ('ready', 'in_progress') AND question.id = ?
        AND target.id = ? AND item.id = ? AND item.user_id = ?
        AND word.id = ? AND word.user_id = ? AND word.review_state IS ?
        AND NOT EXISTS (SELECT 1 FROM answer_attempts AS a
          WHERE a.user_id = ? AND a.practice_question_id = question.id)
        AND (SELECT count(*) FROM answer_attempts AS answer
          JOIN practice_questions AS q ON q.id = answer.practice_question_id
          JOIN practice_targets AS t ON t.id = q.practice_target_id
          JOIN vocabulary_items AS context ON context.id = t.vocabulary_item_id
          WHERE answer.user_id = ? AND context.user_id = ? AND context.word_id = word.id) = ?
        AND (SELECT EXISTS (SELECT 1 FROM assistance_events AS help
          WHERE help.user_id = ? AND help.practice_session_id = ?
            AND help.shown_at <= ? AND
            ((help.kind = 'word_hint' AND help.practice_target_id = target.id)
             OR (help.kind = 'paragraph_translation' AND help.paragraph_id = target.paragraph_id)
             OR help.kind = 'full_translation'))) = ?
        AND (SELECT EXISTS (SELECT 1 FROM assistance_events AS hint
          WHERE hint.user_id = ? AND hint.practice_session_id = ?
            AND hint.shown_at <= ? AND hint.kind = 'word_hint'
            AND hint.practice_target_id = target.id)) = ?
    ) THEN 1 ELSE 0 END)
  `).bind(guardId, input.practiceId, input.userId, question.questionId,
    question.targetId, question.itemId, input.userId, question.wordId,
    input.userId, question.reviewState, input.userId,
    input.userId, input.userId, oldAnswerCount,
    input.userId, input.practiceId, submittedAt, assisted.wasAssisted,
    input.userId, input.practiceId, submittedAt, assisted.wordHint);
}

function eventStatements(
  db: D1DatabaseBinding, wordId: string,
  events: ReturnType<typeof consolidateReviews>,
): D1StatementBinding[] {
  const statements: D1StatementBinding[] = [
    db.prepare('DELETE FROM word_review_events WHERE word_id = ?').bind(wordId),
  ];
  for (let offset = 0; offset < events.length; offset += 100) {
    const chunk = events.slice(offset, offset + 100);
    statements.push(db.prepare(`
      INSERT INTO word_review_events
        (word_id, practice_id, vocabulary_item_id, outcome, was_assisted, reviewed_at)
      SELECT ?, json_extract(value, '$.practiceId'),
        json_extract(value, '$.vocabularyItemId'), json_extract(value, '$.outcome'),
        json_extract(value, '$.wasAssisted'), json_extract(value, '$.reviewedAt')
      FROM json_each(?)
    `).bind(wordId, JSON.stringify(chunk.map((event) => ({
      ...event, wasAssisted: event.wasAssisted ? 1 : 0,
    })))));
  }
  return statements;
}

async function submitNewAnswer(
  db: D1DatabaseBinding,
  input: AnswerSubmission,
  question: QuestionRow,
): Promise<AnswerResult> {
  if (question.status !== 'ready' && question.status !== 'in_progress') {
    throw new AppError('STATE_CONFLICT', '练习尚不能提交答案', 409);
  }
  if (!question.wordId || !question.wordCreatedAt) throw unavailable();
  const createdAt = new Date(question.wordCreatedAt);
  if (!Number.isFinite(createdAt.getTime())) throw unavailable();
  const selection = grade(input.request, question);
  const submittedAt = new Date().toISOString();
  const assisted = await priorAssistance(db, input, question, submittedAt);
  const evidence = await loadEvidence(db, input.userId, question.wordId);
  const answerId = crypto.randomUUID();
  const newEvidence: ReviewEvidence = {
    answerId, practiceId: input.practiceId, vocabularyItemId: question.itemId,
    submittedAt: new Date(submittedAt), isCorrect: selection.isCorrect,
    wasAssisted: assisted.wasAssisted === 1, wordHint: assisted.wordHint === 1,
  };
  const allEvidence = [...evidence, newEvidence];
  const state = replayReviews(allEvidence, createdAt);
  const events = consolidateReviews(allEvidence);
  const guardId = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const completed = `
    (SELECT count(*) FROM practice_questions AS q
      JOIN practice_targets AS t ON t.id = q.practice_target_id
      WHERE t.practice_session_id = practice_sessions.id)
    = (SELECT count(*) FROM answer_attempts AS answer
      WHERE answer.practice_session_id = practice_sessions.id
        AND answer.user_id = practice_sessions.user_id)`;
  await db.batch([
    guard(db, guardId, input, question, evidence.length, assisted, submittedAt),
    db.prepare(`
      INSERT INTO answer_attempts
        (id, practice_session_id, practice_question_id, user_id, answer_kind,
         selected_option_id, is_correct, was_assisted, elapsed_ms,
         idempotency_key, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(answerId, input.practiceId, question.questionId, input.userId,
      input.request.answerKind, selection.selectedOptionId,
      selection.isCorrect ? 1 : 0, assisted.wasAssisted,
      input.request.elapsedMs, input.idempotencyKey, submittedAt),
    db.prepare(`
      INSERT INTO learning_progress
        (vocabulary_item_id, practice_count, first_try_correct_count,
         assisted_count, last_practiced_at, updated_at)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(vocabulary_item_id) DO UPDATE SET
        practice_count = learning_progress.practice_count + 1,
        first_try_correct_count = learning_progress.first_try_correct_count + excluded.first_try_correct_count,
        assisted_count = learning_progress.assisted_count + excluded.assisted_count,
        last_practiced_at = excluded.last_practiced_at,
        updated_at = excluded.updated_at
    `).bind(question.itemId, selection.isCorrect ? 1 : 0,
      assisted.wasAssisted, submittedAt, submittedAt),
    db.prepare(`
      UPDATE vocabulary_items SET status = 'reviewing', updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(submittedAt, question.itemId, input.userId),
    db.prepare(`
      UPDATE vocabulary_words SET review_state = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(JSON.stringify(state), submittedAt, question.wordId, input.userId),
    ...eventStatements(db, question.wordId, events),
    db.prepare(`
      UPDATE practice_sessions
      SET status = CASE WHEN ${completed} THEN 'completed' ELSE 'in_progress' END,
        started_at = COALESCE(started_at, ?),
        completed_at = CASE WHEN ${completed} THEN ? ELSE completed_at END
      WHERE id = ? AND user_id = ?
    `).bind(submittedAt, submittedAt, input.practiceId, input.userId),
    db.prepare(`
      INSERT INTO idempotency_records
        (id, user_id, operation, idempotency_key, request_hash,
         resource_type, resource_id, created_at, expires_at)
      VALUES (?, ?, 'submit_answer', ?, ?, 'answer', ?, ?, ?)
    `).bind(recordId, input.userId, input.idempotencyKey, input.requestHash,
      answerId, submittedAt,
      new Date(Date.parse(submittedAt) + IDEMPOTENCY_TTL_MS).toISOString()),
    db.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
  ]);
  return answerResult({
    id: answerId,
    answerKind: input.request.answerKind,
    selectedOptionId: selection.selectedOptionId,
    isCorrect: selection.isCorrect ? 1 : 0,
    wasAssisted: assisted.wasAssisted,
  }, question);
}

/** Runs inside a per-user Durable Object; D1 guards still protect cross-object writers. */
export async function submitAnswerOnD1(
  db: D1DatabaseBinding,
  input: AnswerSubmission,
): Promise<AnswerResult> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
    const record = await findRecord(db, input.userId, input.idempotencyKey);
    if (record) {
      assertMatchingRecord(record, input.requestHash);
      const question = await loadQuestion(db, input.userId, input.practiceId, input.request.questionId);
      const answer = await existingAnswer(db, input.userId, question.questionId);
      if (!answer || answer.id !== record.resourceId) throw unavailable();
      return answerResult(answer, question);
    }
    const question = await loadQuestion(db, input.userId, input.practiceId, input.request.questionId);
    const answer = await existingAnswer(db, input.userId, question.questionId);
    if (answer) {
      await attachIdempotencyToExisting(db, input, answer.id);
      return answerResult(answer, question);
    }
    try {
      return await submitNewAnswer(db, input, question);
    } catch (error) {
      if (error instanceof AppError) throw error;
      // A D1 CHECK or unique constraint may have rejected a stale read. The
      // transaction rolled back. Re-read the answer and word state before
      // deciding whether to retry the original request.
      if (attempt === MAX_CONFLICT_RETRIES - 1) throw conflict();
    }
  }
  throw conflict();
}

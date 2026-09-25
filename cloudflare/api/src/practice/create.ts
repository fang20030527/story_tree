import {
  CreatePracticeAcceptedSchema,
  CreatePracticeRequestSchema,
  PracticeTopicSchema,
  type CreatePracticeRequest,
  type PracticeStatus,
  type VocabularyInput,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import {
  normalizeMeaningZh,
  normalizeTerm,
  rejectDuplicateInputs,
  vocabularyFingerprint,
} from '../../../../server/src/modules/vocabulary/normalize';
import {
  REVIEW_MODEL_VERSION,
  replayReviews,
  reviewPriority,
  type WordReviewState,
} from '../../../../server/src/modules/vocabulary/scheduler';
import {
  MAX_TOPIC_WORDS,
  planTopicTargets,
  type TopicTargetCandidate,
} from '../../../../server/src/modules/practice/topic-targets';
import { readJsonBody } from '../core/http';
import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import { getRemainingQuota } from '../quota/service';

const PATH = '/v1/practices';
const OPERATION = 'create_practice';
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const POLL_AFTER_MS = 1_500;

interface IdRow { id: string }
interface RecordRow { requestHash: string; resourceType: string; resourceId: string }
interface PracticeRow { status: PracticeStatus }
interface QuotaRow { total: number }
interface ContextRow {
  id: string;
  fingerprint: string;
  normalizedTerm: string;
  normalizedMeaningZh: string;
  createdAt: string;
}
interface ReviewContextRow extends ContextRow {
  wordId: string;
  reviewState: string | null;
  masteredAt: string | null;
}
interface CountRow { count: number }
interface AnswerCountRow { wordId: string | null; answerCount: number }
interface PreparedInput {
  id: string;
  term: string;
  normalizedTerm: string;
  meaningZh: string;
  normalizedMeaningZh: string;
  sourceSentence: string | null;
  fingerprint: string;
}
interface TargetRef { fingerprint: string; expectedState: string | null }
interface ResolvedTargets {
  targets: TargetRef[][];
  vocabulary: PreparedInput[];
  newWords: string[];
}
interface Member {
  id: string;
  topicGroupId: string | null;
  topic: string | null;
  topicPosition: number | null;
  targets: TargetRef[];
  jobId: string;
}

/**
 * Must be supplied by the HTTP assembler only after a practice_generation
 * consumer and scheduled recovery path are both runnable. Default closed.
 */
export interface PracticeCreateCapability {
  generationHandlerReady: boolean;
  scheduledRecoveryReady: boolean;
}

function unavailable(): AppError {
  return new AppError('AI_UNAVAILABLE', '练习生成服务暂时不可用', 503, true);
}

function staleVocabulary(): AppError {
  return new AppError('VOCABULARY_CHANGED', '词库已更新，请刷新列表', 409, true);
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

async function requestHash(material: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(material)) ?? 'undefined');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requestMaterial(input: CreatePracticeRequest): unknown {
  if ('items' in input) {
    return input.format ? { items: input.items, format: input.format } : input.items;
  }
  return {
    source: 'vocabulary',
    ...(input.format ? { format: input.format } : {}),
    targetCount: input.targetCount,
  };
}

function freePracticeLimit(env: ApiEnv): number {
  const raw = (env as ApiEnv & { FREE_PRACTICE_LIMIT?: string | number }).FREE_PRACTICE_LIMIT;
  if (raw === undefined) return 3;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new AppError('INTERNAL_ERROR', '练习额度配置无效', 500, true);
  }
  return limit;
}

function generationDeadlineMs(env: ApiEnv): number {
  if (env.GENERATION_DEADLINE_MS === undefined) return 120_000;
  const duration = Number(env.GENERATION_DEADLINE_MS);
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new AppError('INTERNAL_ERROR', '练习生成配置无效', 500, true);
  }
  return duration;
}

async function loadRecord(db: D1DatabaseBinding, userId: string, key: string): Promise<RecordRow | null> {
  return db.prepare(`
    SELECT request_hash AS requestHash, resource_type AS resourceType,
           resource_id AS resourceId
    FROM idempotency_records
    WHERE user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1
  `).bind(userId, OPERATION, key).first<RecordRow>();
}

async function acceptedForRecord(
  db: D1DatabaseBinding,
  userId: string,
  record: RecordRow,
  hash: string,
  freeLimit: number,
): Promise<Response> {
  if (record.requestHash !== hash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  }
  if (record.resourceType !== 'practice') {
    throw new AppError('INTERNAL_ERROR', '练习幂等记录无效', 500, true);
  }
  const practice = await db.prepare(`
    SELECT status FROM practice_sessions WHERE id = ? AND user_id = ? LIMIT 1
  `).bind(record.resourceId, userId).first<PracticeRow>();
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  const remainingFreePractices = await getRemainingQuota(db, userId, freeLimit);
  return acceptedResponse(record.resourceId, practice.status, remainingFreePractices);
}

function acceptedResponse(
  practiceId: string,
  status: PracticeStatus,
  remainingFreePractices: number,
): Response {
  const pending = status === 'queued' || status === 'generating' || status === 'validating';
  const body = CreatePracticeAcceptedSchema.parse({
    practiceId, status, remainingFreePractices,
    ...(pending ? { pollAfterMs: POLL_AFTER_MS } : {}),
  });
  return Response.json(body, { status: 202, headers: { 'cache-control': 'no-store' } });
}

function randomInt(upperExclusive: number): number {
  const range = 0x1_0000_0000;
  const ceiling = range - (range % upperExclusive);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0]! >= ceiling);
  return value[0]! % upperExclusive;
}

function membersFor(
  practiceId: string,
  format: 'topic_set' | undefined,
  targetSets: TargetRef[][],
): Member[] {
  if (format !== 'topic_set') {
    return [{
      id: practiceId, topicGroupId: null, topic: null,
      topicPosition: null, targets: targetSets[0]!, jobId: crypto.randomUUID(),
    }];
  }
  const topics = [...PracticeTopicSchema.options];
  for (let index = topics.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [topics[index], topics[other]] = [topics[other]!, topics[index]!];
  }
  return topics.slice(0, 4).map((topic, position) => ({
    id: position === 0 ? practiceId : crypto.randomUUID(),
    topicGroupId: practiceId,
    topic,
    topicPosition: position,
    targets: targetSets[position]!,
    jobId: crypto.randomUUID(),
  }));
}

function parseReviewState(raw: string | null, expectedAnswerCount: number): WordReviewState {
  if (!raw) throw staleVocabulary();
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    throw staleVocabulary();
  }
  if (!state || typeof state !== 'object') throw staleVocabulary();
  const parsed = state as Partial<WordReviewState>;
  if (parsed.version !== REVIEW_MODEL_VERSION ||
      parsed.answerCount !== expectedAnswerCount ||
      !Number.isInteger(parsed.practiceCount) || parsed.practiceCount! < 0 ||
      typeof parsed.nextReviewAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.nextReviewAt)) ||
      !parsed.card || typeof parsed.card !== 'object') {
    throw staleVocabulary();
  }
  return parsed as WordReviewState;
}

async function resolveFromVocabulary(
  db: D1DatabaseBinding,
  userId: string,
  count: number,
  format: 'topic_set' | undefined,
): Promise<ResolvedTargets> {
  const requested = format === 'topic_set' ? Math.min(count, MAX_TOPIC_WORDS) : count;
  const [unmatched, contexts, answerCounts] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count FROM vocabulary_items AS v
      LEFT JOIN vocabulary_words AS w ON w.id = v.word_id AND w.user_id = v.user_id
      WHERE v.user_id = ? AND (w.id IS NULL OR w.normalized_term <> v.normalized_term)
    `).bind(userId).first<CountRow>(),
    db.prepare(`
      SELECT v.id, v.fingerprint, v.normalized_term AS normalizedTerm,
             v.normalized_meaning_zh AS normalizedMeaningZh,
             v.created_at AS createdAt, w.id AS wordId,
             w.review_state AS reviewState, w.mastered_at AS masteredAt
      FROM vocabulary_items AS v
      JOIN vocabulary_words AS w ON w.id = v.word_id AND w.user_id = v.user_id
        AND w.normalized_term = v.normalized_term
      WHERE v.user_id = ? AND v.deleted_at IS NULL
      ORDER BY v.created_at DESC, v.id DESC
    `).bind(userId).all<ReviewContextRow>(),
    db.prepare(`
      SELECT v.word_id AS wordId, COUNT(*) AS answerCount
      FROM answer_attempts AS a
      JOIN practice_questions AS q ON q.id = a.practice_question_id
      JOIN practice_targets AS t ON t.id = q.practice_target_id
      JOIN vocabulary_items AS v ON v.id = t.vocabulary_item_id
      WHERE a.user_id = ? AND v.user_id = ?
      GROUP BY v.word_id
    `).bind(userId, userId).all<AnswerCountRow>(),
  ]);
  if ((unmatched?.count ?? 0) !== 0) throw staleVocabulary();
  const counts = new Map(answerCounts.results.map((row) => [row.wordId, row.answerCount]));
  const grouped = new Map<string, ReviewContextRow[]>();
  for (const context of contexts.results) {
    const group = grouped.get(context.wordId) ?? [];
    group.push(context);
    grouped.set(context.wordId, group);
  }
  const now = new Date();
  const ranked = [...grouped.entries()].map(([wordId, group]) => {
    const first = group[0]!;
    const state = parseReviewState(first.reviewState, counts.get(wordId) ?? 0);
    let priority: ReturnType<typeof reviewPriority>;
    try {
      priority = reviewPriority(state, now);
    } catch {
      throw staleVocabulary();
    }
    const chosen = group.find((context) => context.id === state.lastFailedContextId) ?? first;
    return { wordId, group, chosen, priority, state };
  }).filter((entry) => entry.chosen.masteredAt === null && entry.priority.group < 2)
    .sort((left, right) =>
      (left.priority.group === 1 ? 0 : 1) - (right.priority.group === 1 ? 0 : 1) ||
      (left.priority.group === 1 && right.priority.group === 1
        ? left.priority.retrievability - right.priority.retrievability : 0) ||
      left.priority.due - right.priority.due || left.wordId.localeCompare(right.wordId));
  const selected = ranked.slice(0, requested);
  if (selected.length === 0) {
    throw new AppError('INSUFFICIENT_VOCABULARY', '当前没有待复习单词', 422);
  }
  const selectedRefs = selected.map((entry) => ({
    fingerprint: entry.chosen.fingerprint, expectedState: entry.chosen.reviewState,
  }));
  if (format !== 'topic_set') return { targets: [selectedRefs], vocabulary: [], newWords: [] };

  const selectedTerms = new Set(selected.map((entry) => entry.chosen.normalizedTerm));
  const candidates = contexts.results.filter((context) => selectedTerms.has(context.normalizedTerm))
    .map((context): TopicTargetCandidate => ({
      id: context.fingerprint,
      wordKey: context.normalizedTerm,
      meaningKey: context.normalizedMeaningZh,
    }));
  const stateByFingerprint = new Map(contexts.results.map((context) => [context.fingerprint, context.reviewState]));
  const sets = planTopicTargets(selectedRefs.map((target) => target.fingerprint), candidates);
  return {
    targets: sets.map((set) => set.map((fingerprint) => ({
      fingerprint, expectedState: stateByFingerprint.get(fingerprint) ?? null,
    }))),
    vocabulary: [], newWords: [],
  };
}

async function resolveFromItems(
  db: D1DatabaseBinding,
  userId: string,
  items: VocabularyInput[],
  format: 'topic_set' | undefined,
  now: string,
): Promise<ResolvedTargets> {
  rejectDuplicateInputs(items);
  const prepared: PreparedInput[] = items.map((item) => ({
    id: crypto.randomUUID(),
    term: item.term.trim(),
    normalizedTerm: normalizeTerm(item.term),
    meaningZh: item.meaningZh.trim(),
    normalizedMeaningZh: normalizeMeaningZh(item.meaningZh),
    sourceSentence: item.sourceSentence?.trim() ?? null,
    fingerprint: vocabularyFingerprint(item.term, item.meaningZh),
  }));
  const terms = [...new Set(prepared.map((item) => item.normalizedTerm))];
  const placeholders = terms.map(() => '?').join(', ');
  const existing = await db.prepare(`
    SELECT id, fingerprint, normalized_term AS normalizedTerm,
           normalized_meaning_zh AS normalizedMeaningZh, created_at AS createdAt
    FROM vocabulary_items WHERE user_id = ? AND deleted_at IS NULL
      AND normalized_term IN (${placeholders})
    ORDER BY created_at DESC, id DESC
  `).bind(userId, ...terms).all<ContextRow>();
  const knownFingerprints = new Set(existing.results.map((row) => row.fingerprint));
  const prospective = prepared.filter((item) => !knownFingerprints.has(item.fingerprint));
  const candidates = [
    ...existing.results,
    ...prospective.map((item) => ({
      id: item.id, fingerprint: item.fingerprint,
      normalizedTerm: item.normalizedTerm,
      normalizedMeaningZh: item.normalizedMeaningZh, createdAt: now,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id));
  const seenTerms = new Set<string>();
  const selected = prepared.filter((item) => {
    if (seenTerms.has(item.normalizedTerm)) return false;
    seenTerms.add(item.normalizedTerm);
    return true;
  }).map((item) => item.fingerprint);
  if (format !== 'topic_set') {
    return {
      targets: [selected.map((fingerprint) => ({ fingerprint, expectedState: null }))],
      vocabulary: prepared, newWords: terms,
    };
  }
  const sets = planTopicTargets(selected, candidates.map((candidate) => ({
    id: candidate.fingerprint,
    wordKey: candidate.normalizedTerm,
    meaningKey: candidate.normalizedMeaningZh,
  })));
  return {
    targets: sets.map((set) => set.map((fingerprint) => ({ fingerprint, expectedState: null }))),
    vocabulary: prepared, newWords: terms,
  };
}

function targetInsert(
  db: D1DatabaseBinding,
  userId: string,
  recordId: string,
  member: Member,
): D1StatementBinding {
  const rows = member.targets.map((target, position) => ({
    id: crypto.randomUUID(), practiceId: member.id,
    fingerprint: target.fingerprint, position, expectedState: target.expectedState,
  }));
  const values = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const bindings = rows.flatMap((row) => [
    row.id, row.practiceId, row.fingerprint, row.position, row.expectedState,
  ]);
  return db.prepare(`
    WITH desired(target_id, practice_id, fingerprint, position, expected_state) AS (
      VALUES ${values}
    )
    INSERT INTO practice_targets
      (id, practice_session_id, vocabulary_item_id, position)
    SELECT desired.target_id, desired.practice_id, item.id, desired.position
    FROM desired
    JOIN vocabulary_items AS item
      ON item.user_id = ? AND item.fingerprint = desired.fingerprint
      AND item.deleted_at IS NULL
    JOIN vocabulary_words AS word ON word.id = item.word_id
      AND word.user_id = item.user_id
      AND word.normalized_term = item.normalized_term
    WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      AND word.review_state IS NOT NULL
      AND json_extract(word.review_state, '$.version') = ?
      AND json_extract(word.review_state, '$.answerCount') = (
        SELECT COUNT(*) FROM answer_attempts AS answer
        JOIN practice_questions AS question ON question.id = answer.practice_question_id
        JOIN practice_targets AS target ON target.id = question.practice_target_id
        JOIN vocabulary_items AS context ON context.id = target.vocabulary_item_id
        WHERE answer.user_id = item.user_id AND context.user_id = item.user_id
          AND context.word_id = word.id
      )
      AND (desired.expected_state IS NULL OR
        (word.review_state = desired.expected_state AND word.mastered_at IS NULL))
  `).bind(...bindings, userId, recordId, REVIEW_MODEL_VERSION);
}

function buildBatch(
  db: D1DatabaseBinding,
  input: {
    userId: string;
    key: string;
    hash: string;
    recordId: string;
    practiceId: string;
    freeLimit: number;
    now: string;
    expiresAt: string;
    deadlineAt: string;
    resolved: ResolvedTargets;
    members: Member[];
  },
): D1StatementBinding[] {
  const {
    userId, key, hash, recordId, practiceId, freeLimit, now,
    expiresAt, deadlineAt, resolved, members,
  } = input;
  const statements: D1StatementBinding[] = [db.prepare(`
    INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, request_hash,
       resource_type, resource_id, created_at, expires_at)
    SELECT ?, user.id, ?, ?, ?, 'practice', ?, ?, ?
    FROM users AS user WHERE user.id = ? AND user.deleted_at IS NULL
    ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING
    RETURNING id
  `).bind(recordId, OPERATION, key, hash, practiceId, now, expiresAt, userId)];

  for (const member of members) {
    statements.push(db.prepare(`
      INSERT INTO practice_sessions
        (id, user_id, exam_path, status, topic_group_id, topic,
         topic_position, created_at)
      SELECT ?, ?, 'ielts', 'queued', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
    `).bind(member.id, userId, member.topicGroupId, member.topic,
      member.topicPosition, now, recordId));
  }

  statements.push(db.prepare(`
    INSERT INTO usage_ledger
      (id, user_id, practice_session_id, kind, amount, operation_key, created_at)
    SELECT ?, practice.user_id, practice.id, 'reserve', -1, ?, ?
    FROM practice_sessions AS practice
    JOIN users AS user ON user.id = practice.user_id
    WHERE practice.id = ? AND practice.user_id = ? AND user.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
      AND ? + (SELECT COALESCE(SUM(amount), 0) FROM usage_ledger
               WHERE user_id = ?) > 0
    ON CONFLICT(operation_key) DO NOTHING
    RETURNING id
  `).bind(crypto.randomUUID(), `${practiceId}:reserve`, now, practiceId, userId,
    recordId, freeLimit, userId));

  if (resolved.vocabulary.length > 0) {
    const emptyState = JSON.stringify(replayReviews([], new Date(now)));
    for (const term of resolved.newWords) {
      statements.push(db.prepare(`
        INSERT INTO vocabulary_words
          (id, user_id, normalized_term, review_state, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM vocabulary_items
            WHERE user_id = ? AND normalized_term = ?
          )
        ON CONFLICT(user_id, normalized_term) DO NOTHING
      `).bind(crypto.randomUUID(), userId, term, emptyState, now, now,
        recordId, userId, term));
    }
    for (const item of resolved.vocabulary) {
      statements.push(db.prepare(`
        INSERT INTO vocabulary_items
          (id, user_id, term, word_id, normalized_term, meaning_zh,
           normalized_meaning_zh, source_sentence, fingerprint, status,
           created_at, updated_at)
        SELECT ?, ?, ?, word.id, ?, ?, ?, ?, ?, 'pending', ?, ?
        FROM vocabulary_words AS word
        WHERE word.user_id = ? AND word.normalized_term = ?
          AND word.review_state IS NOT NULL
          AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        ON CONFLICT DO NOTHING
      `).bind(item.id, userId, item.term, item.normalizedTerm,
        item.meaningZh, item.normalizedMeaningZh, item.sourceSentence,
        item.fingerprint, now, now, userId, item.normalizedTerm, recordId));
    }
    const terms = resolved.newWords;
    const placeholders = terms.map(() => '?').join(', ');
    statements.push(db.prepare(`
      UPDATE vocabulary_items
      SET word_id = (
        SELECT word.id FROM vocabulary_words AS word
        WHERE word.user_id = vocabulary_items.user_id
          AND word.normalized_term = vocabulary_items.normalized_term
      )
      WHERE user_id = ? AND normalized_term IN (${placeholders})
        AND EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
        AND EXISTS (
          SELECT 1 FROM vocabulary_words AS word
          WHERE word.user_id = vocabulary_items.user_id
            AND word.normalized_term = vocabulary_items.normalized_term
        )
        AND (word_id IS NULL OR word_id <> (
          SELECT word.id FROM vocabulary_words AS word
          WHERE word.user_id = vocabulary_items.user_id
            AND word.normalized_term = vocabulary_items.normalized_term
        ))
    `).bind(userId, ...terms, recordId));
  }

  for (const member of members) statements.push(targetInsert(db, userId, recordId, member));
  for (const member of members) {
    statements.push(db.prepare(`
      INSERT INTO jobs
        (id, kind, resource_id, status, attempt_count, max_attempts,
         available_at, deadline_at, created_at)
      SELECT ?, 'practice_generation', ?, 'queued', 0, 3, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)
    `).bind(member.jobId, member.id, now, deadlineAt, now, recordId));
  }

  const memberIds = members.map((member) => member.id);
  const placeholders = memberIds.map(() => '?').join(', ');
  const expectedTargets = members.reduce((total, member) => total + member.targets.length, 0);
  // resource_id is NOT NULL. A missing reservation, missing target, or missing
  // job sets it to NULL and aborts the whole D1 batch rather than committing
  // a queued practice that can never finish.
  statements.push(db.prepare(`
    UPDATE idempotency_records
    SET resource_id = (
      SELECT CASE WHEN
        EXISTS (SELECT 1 FROM usage_ledger
                WHERE operation_key = ? AND practice_session_id = ?)
        AND (SELECT COUNT(*) FROM practice_targets
             WHERE practice_session_id IN (${placeholders})) = ?
        AND (SELECT COUNT(*) FROM jobs
             WHERE kind = 'practice_generation'
               AND resource_id IN (${placeholders})
               AND status = 'queued') = ?
      THEN ? ELSE NULL END
    )
    WHERE id = ? AND user_id = ? AND operation = ?
    RETURNING resource_id AS resourceId
  `).bind(`${practiceId}:reserve`, practiceId,
    ...memberIds, expectedTargets, ...memberIds, members.length,
    practiceId, recordId, userId, OPERATION));
  statements.push(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM usage_ledger
    WHERE user_id = ?
  `).bind(userId));
  return statements;
}

export async function handlePracticeCreateRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
  capability: PracticeCreateCapability = {
    generationHandlerReady: false,
    scheduledRecoveryReady: false,
  },
): Promise<Response | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== PATH) return null;
  const key = requireIdempotencyKey(request);
  const parsed = CreatePracticeRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '请检查练习创建请求', 400);
  }
  const input = parsed.data;
  if ('items' in input) rejectDuplicateInputs(input.items);
  const freeLimit = freePracticeLimit(env);
  const hash = await requestHash(requestMaterial(input));
  const existing = await loadRecord(env.DB, userId, key);
  if (existing) return acceptedForRecord(env.DB, userId, existing, hash, freeLimit);

  if (!capability.generationHandlerReady || !capability.scheduledRecoveryReady ||
      !env.JOB_QUEUE || !env.EVOLINK_API_KEY) {
    throw unavailable();
  }
  if (await getRemainingQuota(env.DB, userId, freeLimit) <= 0) {
    throw new AppError('FREE_LIMIT_REACHED', '免费练习额度已用完', 403);
  }

  const now = new Date();
  const practiceId = crypto.randomUUID();
  const recordId = crypto.randomUUID();
  const resolved = 'items' in input
    ? await resolveFromItems(env.DB, userId, input.items, input.format, now.toISOString())
    : await resolveFromVocabulary(env.DB, userId, input.targetCount, input.format);
  const members = membersFor(practiceId, input.format, resolved.targets);
  const duration = generationDeadlineMs(env) * members.length;
  const deadline = new Date(now.getTime() + duration);
  if (!Number.isFinite(deadline.getTime())) {
    throw new AppError('INTERNAL_ERROR', '练习生成配置无效', 500, true);
  }
  const batch = buildBatch(env.DB, {
    userId, key, hash, recordId, practiceId, freeLimit,
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    deadlineAt: deadline.toISOString(),
    resolved, members,
  });
  let results: unknown[];
  try {
    results = await env.DB.batch(batch);
  } catch {
    // A concurrent same-key call may have won. Check it before classifying a
    // failed quota or target guard; no partial writes survived a failed batch.
    const raced = await loadRecord(env.DB, userId, key);
    if (raced) return acceptedForRecord(env.DB, userId, raced, hash, freeLimit);
    if (await getRemainingQuota(env.DB, userId, freeLimit) <= 0) {
      throw new AppError('FREE_LIMIT_REACHED', '免费练习额度已用完', 403);
    }
    throw new AppError('DATABASE_UNAVAILABLE', '练习创建暂时不可用，请重试', 503, true);
  }
  if (results.length !== batch.length) {
    throw new AppError('DATABASE_UNAVAILABLE', '练习创建暂时不可用，请重试', 503, true);
  }
  const claimed = batchRows<IdRow>(results[0]);
  if (claimed.length === 0) {
    const raced = await loadRecord(env.DB, userId, key);
    if (!raced) throw new AppError('STATE_CONFLICT', '练习创建状态正在更新，请重试', 409, true);
    return acceptedForRecord(env.DB, userId, raced, hash, freeLimit);
  }
  if (claimed.length !== 1 || claimed[0]?.id !== recordId) {
    throw new AppError('INTERNAL_ERROR', '练习创建状态无效', 500, true);
  }
  const finalized = batchRows<{ resourceId: string }>(results[results.length - 2]);
  const balance = batchRows<QuotaRow>(results[results.length - 1])[0];
  if (finalized[0]?.resourceId !== practiceId || !balance) {
    throw new AppError('INTERNAL_ERROR', '练习创建状态无效', 500, true);
  }

  // D1 jobs are durable. The scheduled recovery handler retries delivery if
  // a Queue send fails after commit.
  await Promise.allSettled(members.map((member) => env.JOB_QUEUE!.send({ jobId: member.jobId })));
  const remaining = Math.min(freeLimit, Math.max(0, freeLimit + balance.total));
  return acceptedResponse(practiceId, 'queued', remaining);
}

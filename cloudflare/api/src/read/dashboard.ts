import { DashboardDtoSchema, VocabularyTimeZoneSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import {
  REVIEW_MODEL_VERSION,
  reviewPriority,
  type WordReviewState,
} from '../../../../server/src/modules/vocabulary/scheduler';
import type { ApiEnv } from '../env';

interface WordRow {
  id: string;
  createdAt: string;
  masteredAt: string | null;
  reviewState: string | null;
}

interface CountRow {
  count: number;
}

interface AnswerCountRow {
  wordId: string | null;
  answerCount: number;
}

interface PracticeIdRow {
  id: string;
}

interface QuotaRow {
  total: number;
}

function staleVocabulary(): AppError {
  return new AppError('INTERNAL_ERROR', '复习状态暂时无法读取', 500, true);
}

function parseReviewState(raw: string | null, expectedAnswerCount: number): WordReviewState {
  if (raw === null) throw staleVocabulary();
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    throw staleVocabulary();
  }
  if (!state || typeof state !== 'object') throw staleVocabulary();
  const candidate = state as Partial<WordReviewState>;
  if (
    candidate.version !== REVIEW_MODEL_VERSION ||
    candidate.answerCount !== expectedAnswerCount ||
    !Number.isInteger(candidate.practiceCount) || candidate.practiceCount! < 0 ||
    typeof candidate.nextReviewAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.nextReviewAt)) ||
    !candidate.card || typeof candidate.card !== 'object'
  ) {
    throw staleVocabulary();
  }
  return candidate as WordReviewState;
}

/** Milliseconds between a UTC instant and the local wall clock in an IANA zone. */
function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const localAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'),
  );
  return localAsUtc - Math.floor(+at / 1_000) * 1_000;
}

function localMidnightUtc(timeZone: string, utcMidnightGuess: number): Date {
  let guess = utcMidnightGuess;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const adjusted = utcMidnightGuess - timeZoneOffsetMs(timeZone, new Date(guess));
    if (adjusted === guess) break;
    guess = adjusted;
  }
  return new Date(guess);
}

/** Copied from the PostgreSQL word-service without its Node/Drizzle imports. */
function localDayRange(timeZone: string, at: Date): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const midnightGuess = Date.UTC(get('year'), get('month') - 1, get('day'));
  return {
    start: localMidnightUtc(timeZone, midnightGuess),
    end: localMidnightUtc(timeZone, midnightGuess + 86_400_000),
  };
}

function parseTimeZone(query: URLSearchParams): string {
  const values = query.getAll('timeZone');
  if (values.length === 0) return 'UTC';
  if (values.length !== 1) {
    throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  }
  const parsed = VocabularyTimeZoneSchema.safeParse(values[0]);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  return parsed.data;
}

function freePracticeLimit(env: ApiEnv): number {
  const raw = (env as ApiEnv & { FREE_PRACTICE_LIMIT?: string | number }).FREE_PRACTICE_LIMIT;
  if (raw === undefined) return 3;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Invalid FREE_PRACTICE_LIMIT configuration');
  }
  return limit;
}

export async function handleDashboardRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (url.pathname !== '/v1/dashboard') return null;

  const timeZone = parseTimeZone(url.searchParams);
  const freeLimit = freePracticeLimit(env);
  const now = new Date();
  const [incomplete, words, unmatchedContexts, answerCounts, completed, quota] = await Promise.all([
    env.DB.prepare(`
      SELECT id FROM practice_sessions
      WHERE user_id = ?1 AND status IN ('queued', 'generating', 'validating', 'ready', 'in_progress')
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).bind(userId).first<PracticeIdRow>(),
    env.DB.prepare(`
      SELECT w.id, w.created_at AS createdAt, w.mastered_at AS masteredAt,
        w.review_state AS reviewState
      FROM vocabulary_words AS w
      WHERE w.user_id = ?1 AND EXISTS (
        SELECT 1 FROM vocabulary_items AS v
        WHERE v.user_id = w.user_id AND v.word_id = w.id AND v.deleted_at IS NULL
      )
    `).bind(userId).all<WordRow>(),
    // The original loadRankedWords lazily links or creates missing word rows.
    // This route is read-only: fail explicitly instead of silently dropping
    // contexts that would have been repaired by the PostgreSQL service.
    env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM vocabulary_items AS v
      LEFT JOIN vocabulary_words AS w ON w.id = v.word_id AND w.user_id = v.user_id
      WHERE v.user_id = ?1
        AND (w.id IS NULL OR w.normalized_term <> v.normalized_term)
    `).bind(userId).first<CountRow>(),
    env.DB.prepare(`
      SELECT v.word_id AS wordId, COUNT(*) AS answerCount
      FROM answer_attempts AS a
      JOIN practice_questions AS q ON q.id = a.practice_question_id
      JOIN practice_targets AS t ON t.id = q.practice_target_id
      JOIN vocabulary_items AS v ON v.id = t.vocabulary_item_id
      WHERE a.user_id = ?1 AND v.user_id = ?1
      GROUP BY v.word_id
    `).bind(userId).all<AnswerCountRow>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count FROM practice_sessions
      WHERE user_id = ?1 AND status = 'completed'
    `).bind(userId).first<CountRow>(),
    env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM usage_ledger WHERE user_id = ?1
    `).bind(userId).first<QuotaRow>(),
  ]);

  if ((unmatchedContexts?.count ?? 0) !== 0) throw staleVocabulary();
  const answerCountByWord = new Map(answerCounts.results.map((row) => [row.wordId, row.answerCount]));
  const day = localDayRange(timeZone, now);
  let dueLearningCount = 0;
  let unlearnedCount = 0;
  let todayAddedCount = 0;
  for (const word of words.results) {
    const state = parseReviewState(word.reviewState, answerCountByWord.get(word.id) ?? 0);
    const createdAt = Date.parse(word.createdAt);
    if (!Number.isFinite(createdAt)) throw staleVocabulary();
    if (createdAt >= +day.start && createdAt < +day.end) todayAddedCount += 1;
    if (word.masteredAt !== null) continue;
    let group: number;
    try {
      group = reviewPriority(state, now).group;
    } catch {
      throw staleVocabulary();
    }
    if (state.practiceCount > 0 && group === 1) dueLearningCount += 1;
    if (state.practiceCount === 0) unlearnedCount += 1;
  }

  const remainingFreePractices = Math.min(
    freeLimit,
    Math.max(0, freeLimit + (quota?.total ?? 0)),
  );
  const body = DashboardDtoSchema.parse({
    incompletePracticeId: incomplete?.id ?? null,
    vocabularyCount: words.results.length,
    reviewingCount: dueLearningCount,
    dueLearningCount,
    unlearnedCount,
    todayAddedCount,
    completedPracticeCount: completed?.count ?? 0,
    remainingFreePractices,
  });
  const headers = { 'cache-control': 'no-store' };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return Response.json(body, { status: 200, headers });
}

import {
  UuidSchema,
  VocabularyTimeZoneSchema,
  VocabularyWordFilterSchema,
  VocabularyWordPageSchema,
  type VocabularyWord,
  type VocabularyWordFilter,
} from '@context-reader/contracts';
import { z } from 'zod';

import { AppError } from '../../../../server/src/core/errors';
import {
  REVIEW_MODEL_VERSION,
  reviewPriority,
  type WordReviewState,
} from '../../../../server/src/modules/vocabulary/scheduler';
import type { ApiEnv } from '../env';

const CursorSchema = z.object({
  version: z.literal(2),
  userId: UuidSchema,
  filter: VocabularyWordFilterSchema,
  timeZone: VocabularyTimeZoneSchema,
  evaluatedAt: z.iso.datetime(),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  lastWordId: UuidSchema,
}).strict();

const finiteNumber = z.number().finite();
const ReviewStateSchema = z.object({
  version: z.literal(REVIEW_MODEL_VERSION),
  answerCount: z.number().int().nonnegative(),
  card: z.object({
    due: z.iso.datetime(),
    last_review: z.iso.datetime().optional(),
    stability: finiteNumber,
    difficulty: finiteNumber,
    elapsed_days: finiteNumber,
    scheduled_days: finiteNumber,
    reps: z.number().int().nonnegative(),
    lapses: z.number().int().nonnegative(),
    learning_steps: z.number().int().nonnegative(),
    state: z.number().int().nonnegative(),
  }).passthrough(),
  nextReviewAt: z.iso.datetime(),
  practiceCount: z.number().int().nonnegative(),
  independentCorrectCount: z.number().int().nonnegative(),
  assistedCount: z.number().int().nonnegative(),
  lastPracticedAt: z.iso.datetime().nullable(),
  lastOutcome: z.enum(['independent', 'failed', 'translated']).nullable(),
  lastFailedContextId: UuidSchema.nullable(),
}).strict();

interface WordRow {
  id: string;
  normalizedTerm: string;
  reviewState: string | null;
  masteredAt: string | null;
  createdAt: string;
}

interface ContextRow {
  id: string;
  normalizedTerm: string;
  term: string;
  meaningZh: string;
  sourceSentence: string | null;
  createdAt: string;
  deletedAt: string | null;
}

interface CountRow {
  wordId: string;
  answerCount: number;
}

interface Context {
  id: string;
  term: string;
  meaningZh: string;
  sourceSentence: string | null;
  createdAt: Date;
}

interface RankedWord {
  word: { id: string; createdAt: Date; masteredAt: Date | null };
  state: WordReviewState;
  contexts: Context[];
  priority: ReturnType<typeof reviewPriority>;
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_ERROR', '词库游标格式无效', 400);
}

function changed(): AppError {
  return new AppError('VOCABULARY_CHANGED', '词库已更新，请刷新列表', 409, true);
}

function invalidProjection(): AppError {
  return new AppError('INTERNAL_ERROR', '词库复习状态需要修复', 500);
}

function decodeCursor(value: string): z.infer<typeof CursorSchema> {
  try {
    if (value.length === 0 || value.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
      throw invalidCursor();
    }
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const normalized = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    if (normalized !== value) throw invalidCursor();
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return CursorSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw invalidCursor();
  }
}

function encodeCursor(cursor: z.infer<typeof CursorSchema>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
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

function parseTimeZone(value: string | null): string {
  if (value === null) return 'UTC';
  const parsed = VocabularyTimeZoneSchema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  return parsed.data;
}

function parseFilter(value: string | null): VocabularyWordFilter {
  const parsed = VocabularyWordFilterSchema.safeParse(value ?? 'learning');
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '词库筛选格式无效', 400);
  return parsed.data;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw invalidProjection();
  return date;
}

function parseReviewState(raw: string | null, answerCount: number): WordReviewState {
  if (raw === null) throw invalidProjection();
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw invalidProjection();
  }
  const parsed = ReviewStateSchema.safeParse(input);
  if (!parsed.success || parsed.data.answerCount !== answerCount ||
      parsed.data.practiceCount > parsed.data.answerCount ||
      parsed.data.independentCorrectCount > parsed.data.practiceCount ||
      parsed.data.assistedCount > parsed.data.practiceCount) {
    throw invalidProjection();
  }
  return parsed.data as WordReviewState;
}

function batchRows<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('results' in result) ||
      !Array.isArray(result.results)) {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时无法访问', 503, true);
  }
  return result.results as T[];
}

async function loadRankedWords(
  env: ApiEnv,
  userId: string,
  evaluatedAt: Date,
): Promise<RankedWord[]> {
  // D1 batch runs these reads inside one transaction. The answer count is
  // grouped by normalized term, matching the old read-time word-link repair
  // without modifying migrated data during this GET request.
  const batch = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, normalized_term AS normalizedTerm, review_state AS reviewState,
             mastered_at AS masteredAt, created_at AS createdAt
      FROM vocabulary_words WHERE user_id = ?
    `).bind(userId),
    env.DB.prepare(`
      SELECT id, normalized_term AS normalizedTerm, term,
             meaning_zh AS meaningZh, source_sentence AS sourceSentence,
             created_at AS createdAt, deleted_at AS deletedAt
      FROM vocabulary_items WHERE user_id = ?
    `).bind(userId),
    env.DB.prepare(`
      SELECT w.id AS wordId, COUNT(*) AS answerCount
      FROM answer_attempts AS answer
      JOIN practice_questions AS question ON question.id = answer.practice_question_id
      JOIN practice_targets AS target ON target.id = question.practice_target_id
      JOIN vocabulary_items AS item ON item.id = target.vocabulary_item_id
      JOIN vocabulary_words AS w
        ON w.user_id = item.user_id AND w.normalized_term = item.normalized_term
      WHERE answer.user_id = ? AND item.user_id = ?
      GROUP BY w.id
    `).bind(userId, userId),
  ]);
  const words = batchRows<WordRow>(batch[0]);
  const contextRows = batchRows<ContextRow>(batch[1]);
  const counts = batchRows<CountRow>(batch[2]);
  const answerCounts = new Map(counts.map((row) => [row.wordId, row.answerCount]));
  const byTerm = new Map(words.map((word) => [word.normalizedTerm, word]));
  const contextsByTerm = new Map<string, Context[]>();
  for (const row of contextRows) {
    if (!byTerm.has(row.normalizedTerm)) throw invalidProjection();
    if (row.deletedAt !== null) continue;
    const contexts = contextsByTerm.get(row.normalizedTerm) ?? [];
    contexts.push({
      id: row.id,
      term: row.term,
      meaningZh: row.meaningZh,
      sourceSentence: row.sourceSentence,
      createdAt: parseDate(row.createdAt),
    });
    contextsByTerm.set(row.normalizedTerm, contexts);
  }
  for (const contexts of contextsByTerm.values()) {
    contexts.sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id));
  }

  const ranked: RankedWord[] = [];
  for (const row of words) {
    const state = parseReviewState(row.reviewState, answerCounts.get(row.id) ?? 0);
    const active = contextsByTerm.get(row.normalizedTerm);
    if (!active?.length) continue;
    let priority: ReturnType<typeof reviewPriority>;
    try {
      priority = reviewPriority(state, evaluatedAt);
    } catch {
      throw invalidProjection();
    }
    if (!Number.isFinite(priority.due) || !Number.isFinite(priority.retrievability) ||
        ![0, 1, 2].includes(priority.group)) {
      throw invalidProjection();
    }
    ranked.push({
      word: {
        id: row.id,
        createdAt: parseDate(row.createdAt),
        masteredAt: row.masteredAt === null ? null : parseDate(row.masteredAt),
      },
      state,
      contexts: active,
      priority,
    });
  }
  return ranked.sort((a, b) => a.priority.group - b.priority.group ||
    (a.priority.group === 1 ? a.priority.retrievability - b.priority.retrievability : 0) ||
    a.priority.due - b.priority.due || a.word.id.localeCompare(b.word.id));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

async function revisionOf(entries: RankedWord[]): Promise<string> {
  // Clock-derived priority is excluded, so waiting alone does not invalidate
  // an in-progress page. This structure matches the original SHA-256 input.
  const canonical = canonicalize([...entries]
    .sort((a, b) => a.word.id.localeCompare(b.word.id))
    .map((entry) => ({
      id: entry.word.id,
      state: entry.state,
      masteredAt: entry.word.masteredAt?.toISOString() ?? null,
      contexts: entry.contexts.map(({ id, term, meaningZh, sourceSentence }) => ({
        id, term, meaningZh, sourceSentence,
      })),
    })));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const localAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), get('hour') % 24,
    get('minute'), get('second'),
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

function toWordDto(entry: RankedWord): VocabularyWord {
  const context = entry.contexts[0]!;
  return {
    wordId: entry.word.id,
    term: context.term,
    meaningZh: context.meaningZh,
    sourceSentence: context.sourceSentence,
    contextCount: entry.contexts.length,
    reviewReason: entry.priority.group === 2 ? 'scheduled'
      : entry.state.practiceCount === 0 ? 'new'
        : entry.state.lastOutcome !== 'independent' ? 'relearn' : 'due',
    nextReviewAt: entry.state.nextReviewAt,
    practiceCount: entry.state.practiceCount,
    independentCorrectCount: entry.state.independentCorrectCount,
    assistedCount: entry.state.assistedCount,
    lastPracticedAt: entry.state.lastPracticedAt,
    masteredAt: entry.word.masteredAt?.toISOString() ?? null,
  };
}

export async function handleVocabularyWordRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/vocabulary-words' || request.method !== 'GET') {
    return null;
  }

  const parameters = url.searchParams;
  if (parameters.getAll('filter').length > 1) {
    throw new AppError('VALIDATION_ERROR', '词库筛选格式无效', 400);
  }
  if (parameters.getAll('timeZone').length > 1) {
    throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  }
  if (parameters.getAll('limit').length > 1) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  if (parameters.getAll('cursor').length > 1) throw invalidCursor();

  const filter = parseFilter(parameters.get('filter'));
  const timeZone = parseTimeZone(parameters.get('timeZone'));
  const limit = parseLimit(parameters.get('limit'));
  const rawCursor = parameters.get('cursor');
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  const now = new Date();
  if (cursor && (cursor.userId !== userId || cursor.filter !== filter ||
      cursor.timeZone !== timeZone || Date.parse(cursor.evaluatedAt) > +now)) {
    throw invalidCursor();
  }
  if (cursor && +now - Date.parse(cursor.evaluatedAt) > 30 * 60_000) throw changed();
  const evaluatedAt = cursor ? new Date(cursor.evaluatedAt) : now;

  const entries = await loadRankedWords(env, userId, evaluatedAt);
  const revision = await revisionOf(entries);
  if (cursor && cursor.revision !== revision) throw changed();

  const day = localDayRange(timeZone, evaluatedAt);
  const isMastered = (entry: RankedWord) => entry.word.masteredAt !== null;
  const isToday = (entry: RankedWord) =>
    +entry.word.createdAt >= +day.start && +entry.word.createdAt < +day.end;
  const isLearning = (entry: RankedWord) =>
    !isMastered(entry) && entry.state.practiceCount > 0;
  const isUnlearned = (entry: RankedWord) =>
    !isMastered(entry) && entry.state.practiceCount === 0;
  const predicates: Record<VocabularyWordFilter, (entry: RankedWord) => boolean> = {
    all: () => true,
    due: (entry) => !isMastered(entry) && entry.priority.group < 2,
    scheduled: (entry) => !isMastered(entry) && entry.priority.group === 2,
    today: isToday,
    learning: isLearning,
    unlearned: isUnlearned,
    mastered: isMastered,
  };
  const filtered = entries.filter(predicates[filter]);
  const cursorIndex = cursor
    ? filtered.findIndex((entry) => entry.word.id === cursor.lastWordId)
    : -1;
  if (cursor && cursorIndex < 0) throw invalidCursor();
  const page = filtered.slice(cursorIndex + 1, cursorIndex + 1 + limit);
  const last = page.at(-1);
  const nextCursor = last && cursorIndex + 1 + page.length < filtered.length
    ? encodeCursor({
      version: 2,
      userId,
      filter,
      timeZone,
      evaluatedAt: evaluatedAt.toISOString(),
      revision,
      lastWordId: last.word.id,
    })
    : null;
  let nextRefreshTime = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (isMastered(entry) || entry.priority.due <= +evaluatedAt) continue;
    nextRefreshTime = Math.min(nextRefreshTime, entry.priority.due);
  }
  const nextRefreshAt = Number.isFinite(nextRefreshTime)
    ? new Date(nextRefreshTime).toISOString() : null;

  const body = VocabularyWordPageSchema.parse({
    items: page.map(toWordDto),
    nextCursor,
    evaluatedAt: evaluatedAt.toISOString(),
    nextRefreshAt,
    summary: {
      totalCount: entries.length,
      todayCount: entries.filter(isToday).length,
      learningCount: entries.filter(isLearning).length,
      dueLearningCount: entries.filter((entry) =>
        isLearning(entry) && entry.priority.group === 1).length,
      unlearnedCount: entries.filter(isUnlearned).length,
      masteredCount: entries.filter(isMastered).length,
    },
  });
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}

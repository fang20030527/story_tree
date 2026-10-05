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
  /** The stored JSON, which the page revision digests instead of re-serializing the state. */
  rawState: string;
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

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const OUTCOMES = new Set<unknown>([null, 'independent', 'failed', 'translated']);

/**
 * Hand-written structural check of a stored review state: a schema parse of every word cost
 * more CPU than the 10 ms a free-plan request has once a vocabulary reaches a few hundred words.
 * Every answer rewrites the state in the same D1 batch, guarded by the answer count, so the
 * read no longer recounts the user's whole answer history to compare against it.
 */
function parseReviewState(raw: string | null): WordReviewState {
  if (raw === null) throw invalidProjection();
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw invalidProjection();
  }
  if (!input || typeof input !== 'object') throw invalidProjection();
  const state = input as Record<string, unknown>;
  const card = state.card as Record<string, unknown> | null | undefined;
  if (state.version !== REVIEW_MODEL_VERSION || !count(state.answerCount) ||
      !count(state.practiceCount) || !count(state.independentCorrectCount) || !count(state.assistedCount) ||
      state.practiceCount > state.answerCount ||
      state.independentCorrectCount > state.practiceCount || state.assistedCount > state.practiceCount ||
      !instant(state.nextReviewAt) || !(state.lastPracticedAt === null || instant(state.lastPracticedAt)) ||
      !OUTCOMES.has(state.lastOutcome) ||
      !(state.lastFailedContextId === null || UuidSchema.safeParse(state.lastFailedContextId).success) ||
      !card || typeof card !== 'object' || !instant(card.due) ||
      !(card.last_review === undefined || instant(card.last_review)) ||
      !finite(card.stability) || !finite(card.difficulty) ||
      !finite(card.elapsed_days) || !finite(card.scheduled_days) ||
      !count(card.reps) || !count(card.lapses) || !count(card.learning_steps) || !count(card.state)) {
    throw invalidProjection();
  }
  return input as WordReviewState;
}

/** Code-unit order: ids are lowercase ASCII, and localeCompare is costly in a long sort. */
const byText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

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
  // D1 batch runs these reads inside one transaction.
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
  ]);
  const words = batchRows<WordRow>(batch[0]);
  const contextRows = batchRows<ContextRow>(batch[1]);
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
    contexts.sort((a, b) => +b.createdAt - +a.createdAt || byText(b.id, a.id));
  }

  const ranked: RankedWord[] = [];
  for (const row of words) {
    const active = contextsByTerm.get(row.normalizedTerm);
    if (!active?.length) continue;
    const state = parseReviewState(row.reviewState);
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
      rawState: row.reviewState!,
      contexts: active,
      priority,
    });
  }
  return ranked.sort((a, b) => a.priority.group - b.priority.group ||
    (a.priority.group === 1 ? a.priority.retrievability - b.priority.retrievability : 0) ||
    a.priority.due - b.priority.due || byText(a.word.id, b.word.id));
}

async function revisionOf(entries: RankedWord[]): Promise<string> {
  // Clock-derived priority is excluded, so waiting alone does not invalidate
  // an in-progress page. The stored state text changes whenever the state does.
  const material = [...entries]
    .sort((a, b) => byText(a.word.id, b.word.id))
    .map((entry) => [
      entry.word.id,
      entry.rawState,
      entry.word.masteredAt?.toISOString() ?? null,
      entry.contexts.map(({ id, term, meaningZh, sourceSentence }) => [id, term, meaningZh, sourceSentence]),
    ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(material)),
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

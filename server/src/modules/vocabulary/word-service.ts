import { createHash } from 'node:crypto';

import {
  UuidSchema, VocabularyTimeZoneSchema, VocabularyWordContextsSchema, VocabularyWordFilterSchema,
  VocabularyWordMasterySchema, VocabularyWordPageSchema,
  type VocabularyWord, type VocabularyWordFilter, type VocabularyWordMastery,
} from '@context-reader/contracts';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { vocabularyWords } from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { loadRankedWords, lockVocabulary, syncVocabularyWords, type RankedWord } from './word-state';

const CursorSchema = z.object({
  version: z.literal(2), userId: UuidSchema, filter: VocabularyWordFilterSchema,
  timeZone: VocabularyTimeZoneSchema,
  evaluatedAt: z.iso.datetime(), revision: z.string().regex(/^[a-f0-9]{64}$/), lastWordId: UuidSchema,
}).strict();

export interface WordPageInput {
  userId: string;
  filter: VocabularyWordFilter;
  limit: number;
  cursor: string | null;
  timeZone?: string;
  now?: Date;
}

function invalidCursor() { return new AppError('VALIDATION_ERROR', '词库游标格式无效', 400); }
function changed() { return new AppError('VOCABULARY_CHANGED', '词库已更新，请刷新列表', 409, true); }

function decodeCursor(value: string) {
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw invalidCursor();
    return CursorSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch { throw invalidCursor(); }
}

function toWordDto(entry: RankedWord): VocabularyWord {
  const context = entry.contexts[0]!;
  return {
    wordId: entry.word.id, term: context.term, meaningZh: context.meaningZh,
    sourceSentence: context.sourceSentence, contextCount: entry.contexts.length,
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

/** Revision excludes clock-derived priority: merely waiting must not invalidate pagination. */
function revisionOf(entries: RankedWord[]) {
  return createHash('sha256').update(JSON.stringify(canonicalize([...entries]
    .sort((a, b) => a.word.id.localeCompare(b.word.id))
    .map((entry) => ({ id: entry.word.id, state: entry.state,
      masteredAt: entry.word.masteredAt?.toISOString() ?? null,
      contexts: entry.contexts.map(({ id, term, meaningZh, sourceSentence }) => ({ id, term, meaningZh, sourceSentence })),
    }))))).digest('hex');
}

/** PostgreSQL jsonb reorders object keys; that must not look like a state change. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
  return value;
}

/** Milliseconds between the UTC instant and the local wall clock in the zone. */
function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return localAsUtc - Math.floor(+at / 1_000) * 1_000;
}

/** UTC instant of local midnight for the wall-clock day containing utcGuess. */
function localMidnightUtc(timeZone: string, utcMidnightGuess: number): Date {
  let guess = utcMidnightGuess;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const adjusted = utcMidnightGuess - timeZoneOffsetMs(timeZone, new Date(guess));
    if (adjusted === guess) break;
    guess = adjusted;
  }
  return new Date(guess);
}

/** Start (inclusive) and end (exclusive) of the natural day containing `at` in `timeZone`. */
export function localDayRange(timeZone: string, at: Date): { start: Date; end: Date } {
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

export async function getVocabularyWordPage(db: AppDatabase, input: WordPageInput) {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? 'UTC';
  if (!VocabularyTimeZoneSchema.safeParse(timeZone).success) {
    throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  }
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  if (cursor && (cursor.userId !== input.userId || cursor.filter !== input.filter
    || cursor.timeZone !== timeZone || Date.parse(cursor.evaluatedAt) > +now)) {
    throw invalidCursor();
  }
  if (cursor && +now - Date.parse(cursor.evaluatedAt) > 30 * 60_000) throw changed();
  const evaluatedAt = cursor ? new Date(cursor.evaluatedAt) : now;
  return db.transaction(async (tx) => {
    const entries = await loadRankedWords(tx, input.userId, evaluatedAt);
    const revision = revisionOf(entries);
    if (cursor && cursor.revision !== revision) throw changed();
    // The day window derives from the cursor-fixed evaluatedAt, so paging never drifts across midnight.
    const day = localDayRange(timeZone, evaluatedAt);
    const isMastered = (entry: RankedWord) => entry.word.masteredAt !== null;
    const isToday = (entry: RankedWord) => +entry.word.createdAt >= +day.start && +entry.word.createdAt < +day.end;
    const isLearning = (entry: RankedWord) => !isMastered(entry) && entry.state.practiceCount > 0;
    const isUnlearned = (entry: RankedWord) => !isMastered(entry) && entry.state.practiceCount === 0;
    const predicates: Record<VocabularyWordFilter, (entry: RankedWord) => boolean> = {
      all: () => true,
      due: (entry) => !isMastered(entry) && entry.priority.group < 2,
      scheduled: (entry) => !isMastered(entry) && entry.priority.group === 2,
      today: isToday,
      learning: isLearning,
      unlearned: isUnlearned,
      mastered: isMastered,
    };
    const filtered = entries.filter(predicates[input.filter]);
    const cursorIndex = cursor ? filtered.findIndex((entry) => entry.word.id === cursor.lastWordId) : -1;
    if (cursor && cursorIndex < 0) throw invalidCursor();
    const page = filtered.slice(cursorIndex + 1, cursorIndex + 1 + input.limit);
    const last = page.at(-1);
    const nextCursor = last && cursorIndex + 1 + page.length < filtered.length
      ? Buffer.from(JSON.stringify({ version: 2, userId: input.userId, filter: input.filter, timeZone,
        evaluatedAt: evaluatedAt.toISOString(), revision, lastWordId: last.word.id,
      })).toString('base64url') : null;
    const future = entries.filter((entry) => !isMastered(entry))
      .map((entry) => Date.parse(entry.state.nextReviewAt)).filter((date) => date > +evaluatedAt);
    return VocabularyWordPageSchema.parse({
      items: page.map(toWordDto), nextCursor, evaluatedAt: evaluatedAt.toISOString(),
      nextRefreshAt: future.length ? new Date(Math.min(...future)).toISOString() : null,
      summary: {
        totalCount: entries.length,
        todayCount: entries.filter(isToday).length,
        learningCount: entries.filter(isLearning).length,
        dueLearningCount: entries.filter((entry) => isLearning(entry) && entry.priority.group === 1).length,
        unlearnedCount: entries.filter(isUnlearned).length,
        masteredCount: entries.filter(isMastered).length,
      },
    });
  });
}

export async function getVocabularyWordContexts(db: AppDatabase, userId: string, wordId: string) {
  if (!UuidSchema.safeParse(wordId).success) throw new AppError('VALIDATION_ERROR', '单词格式无效', 400);
  return db.transaction(async (tx) => {
    const { contexts } = await syncVocabularyWords(tx, userId);
    const active = contexts.filter((context) => context.wordId === wordId && !context.deletedAt);
    if (!active.length) throw new AppError('NOT_FOUND', '单词不存在', 404);
    return VocabularyWordContextsSchema.parse({ wordId, contexts: active.map(({ id, meaningZh, sourceSentence }) => ({ id, meaningZh, sourceSentence })) });
  });
}

/** Marks or clears a word-level mastery flag; review evidence and scheduling stay untouched. */
export async function setVocabularyWordMastery(
  db: AppDatabase,
  input: { userId: string; wordId: string; mastered: boolean; idempotencyKey: string },
): Promise<VocabularyWordMastery> {
  if (!UuidSchema.safeParse(input.wordId).success) throw new AppError('VALIDATION_ERROR', '单词格式无效', 400);
  const operation = input.mastered ? 'mark_vocabulary_word_mastered' as const : 'restore_vocabulary_word' as const;
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(tx, input.userId, operation, input.idempotencyKey, { wordId: input.wordId });
    if (!replay) {
      await lockVocabulary(tx, input.userId);
      const [updated] = await tx.update(vocabularyWords)
        .set({ masteredAt: input.mastered ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(vocabularyWords.id, input.wordId), eq(vocabularyWords.userId, input.userId)))
        .returning({ id: vocabularyWords.id });
      if (!updated) throw new AppError('NOT_FOUND', '单词不存在', 404);
      await finishIdempotentOperation(tx, input.userId, operation, input.idempotencyKey, input.wordId);
    }
    const [word] = await tx.select({ masteredAt: vocabularyWords.masteredAt }).from(vocabularyWords)
      .where(and(eq(vocabularyWords.id, input.wordId), eq(vocabularyWords.userId, input.userId)))
      .limit(1);
    if (!word) throw new AppError('NOT_FOUND', '单词不存在', 404);
    return VocabularyWordMasterySchema.parse({ wordId: input.wordId, masteredAt: word.masteredAt?.toISOString() ?? null });
  });
}

import { createHash } from 'node:crypto';

import {
  UuidSchema, VocabularyWordContextsSchema, VocabularyWordFilterSchema,
  VocabularyWordPageSchema, type VocabularyWord, type VocabularyWordFilter,
} from '@context-reader/contracts';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { loadRankedWords, syncVocabularyWords, type RankedWord } from './word-state';

const CursorSchema = z.object({
  version: z.literal(1), userId: UuidSchema, filter: VocabularyWordFilterSchema,
  evaluatedAt: z.iso.datetime(), revision: z.string().regex(/^[a-f0-9]{64}$/), lastWordId: UuidSchema,
}).strict();

export interface WordPageInput {
  userId: string;
  filter: VocabularyWordFilter;
  limit: number;
  cursor: string | null;
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
  };
}

/** Revision excludes clock-derived priority: merely waiting must not invalidate pagination. */
function revisionOf(entries: RankedWord[]) {
  return createHash('sha256').update(JSON.stringify(canonicalize([...entries]
    .sort((a, b) => a.word.id.localeCompare(b.word.id))
    .map((entry) => ({ id: entry.word.id, state: entry.state,
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

export async function getVocabularyWordPage(db: AppDatabase, input: WordPageInput) {
  const now = input.now ?? new Date();
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  if (cursor && (cursor.userId !== input.userId || cursor.filter !== input.filter || Date.parse(cursor.evaluatedAt) > +now)) {
    throw invalidCursor();
  }
  if (cursor && +now - Date.parse(cursor.evaluatedAt) > 30 * 60_000) throw changed();
  const evaluatedAt = cursor ? new Date(cursor.evaluatedAt) : now;
  return db.transaction(async (tx) => {
    const entries = await loadRankedWords(tx, input.userId, evaluatedAt);
    const revision = revisionOf(entries);
    if (cursor && cursor.revision !== revision) throw changed();
    const dueCount = entries.filter((entry) => entry.priority.group < 2).length;
    const filtered = entries.filter((entry) => input.filter === 'all' ||
      (input.filter === 'due' ? entry.priority.group < 2 : entry.priority.group === 2));
    const cursorIndex = cursor ? filtered.findIndex((entry) => entry.word.id === cursor.lastWordId) : -1;
    if (cursor && cursorIndex < 0) throw invalidCursor();
    const page = filtered.slice(cursorIndex + 1, cursorIndex + 1 + input.limit);
    const last = page.at(-1);
    const nextCursor = last && cursorIndex + 1 + page.length < filtered.length
      ? Buffer.from(JSON.stringify({ version: 1, userId: input.userId, filter: input.filter,
        evaluatedAt: evaluatedAt.toISOString(), revision, lastWordId: last.word.id,
      })).toString('base64url') : null;
    const future = entries.map((entry) => Date.parse(entry.state.nextReviewAt)).filter((date) => date > +evaluatedAt);
    return VocabularyWordPageSchema.parse({
      items: page.map(toWordDto), nextCursor, evaluatedAt: evaluatedAt.toISOString(),
      nextRefreshAt: future.length ? new Date(Math.min(...future)).toISOString() : null,
      summary: { totalCount: entries.length, dueCount, scheduledCount: entries.length - dueCount },
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

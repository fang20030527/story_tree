import {
  VocabularyItemDtoSchema,
  VocabularyPageSchema,
  UuidSchema,
  type VocabularyInput,
  type VocabularyItemDto,
  type VocabularyPage,
} from '@context-reader/contracts';
import {
  and,
  desc,
  eq,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { learningProgress, vocabularyItems } from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { upsertExactVocabularyItems } from './repository';

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const CURSOR_MAX_LENGTH = 512;
const CursorPayloadSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: UuidSchema,
  })
  .strict();

interface VocabularyCursor {
  createdAt: string;
  id: string;
}

export interface CreateVocabularyItemInput {
  userId: string;
  item: VocabularyInput;
  idempotencyKey: string;
}

/**
 * Save one contextual word to the same durable vocabulary used by practice
 * creation.  The fingerprint constraint makes repeated taps safe, while the
 * idempotency record also makes a retried network request return the same row.
 */
export async function createVocabularyItemForUser(
  db: AppDatabase,
  input: CreateVocabularyItemInput,
): Promise<VocabularyItemDto> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'create_vocabulary_item',
      input.idempotencyKey,
      input.item,
    );
    const itemId = replay
      ?? (await upsertExactVocabularyItems(tx, input.userId, [input.item]))[0];
    if (!itemId) {
      throw new AppError('INTERNAL_ERROR', '词义保存失败', 500, true);
    }
    if (!replay) {
      await finishIdempotentOperation(
        tx,
        input.userId,
        'create_vocabulary_item',
        input.idempotencyKey,
        itemId,
      );
    }
    return loadVocabularyItem(tx, input.userId, itemId);
  });
}

async function loadVocabularyItem(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  itemId: string,
): Promise<VocabularyItemDto> {
  const [row] = await db
    .select({
      id: vocabularyItems.id,
      term: vocabularyItems.term,
      meaningZh: vocabularyItems.meaningZh,
      sourceSentence: vocabularyItems.sourceSentence,
      status: vocabularyItems.status,
      practiceCount: sql<number>`coalesce(${learningProgress.practiceCount}, 0)::int`,
      firstTryCorrectCount: sql<number>`coalesce(${learningProgress.firstTryCorrectCount}, 0)::int`,
      assistedCount: sql<number>`coalesce(${learningProgress.assistedCount}, 0)::int`,
      lastPracticedAt: learningProgress.lastPracticedAt,
    })
    .from(vocabularyItems)
    .leftJoin(
      learningProgress,
      eq(learningProgress.vocabularyItemId, vocabularyItems.id),
    )
    .where(
      and(
        eq(vocabularyItems.id, itemId),
        eq(vocabularyItems.userId, userId),
        isNull(vocabularyItems.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', '词义不存在', 404);
  return VocabularyItemDtoSchema.parse({
    id: row.id,
    term: row.term,
    meaningZh: row.meaningZh,
    sourceSentence: row.sourceSentence,
    status: row.status,
    practiceCount: row.practiceCount,
    firstTryCorrectCount: row.firstTryCorrectCount,
    assistedCount: row.assistedCount,
    lastPracticedAt: row.lastPracticedAt?.toISOString() ?? null,
  });
}

export async function getVocabularyPage(
  db: AppDatabase,
  input: {
    userId: string;
    limit: number;
    cursor: string | null;
  },
): Promise<VocabularyPage> {
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursor) await assertKnownCursor(db, input.userId, cursor);

  const filters: SQL[] = [
    eq(vocabularyItems.userId, input.userId),
    isNull(vocabularyItems.deletedAt),
  ];
  if (cursor) filters.push(olderThanCursor(cursor));

  const rows = await db
    .select({
      id: vocabularyItems.id,
      term: vocabularyItems.term,
      meaningZh: vocabularyItems.meaningZh,
      sourceSentence: vocabularyItems.sourceSentence,
      status: vocabularyItems.status,
      createdAtCursor: sql<string>`to_char(${vocabularyItems.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      practiceCount: sql<number>`coalesce(${learningProgress.practiceCount}, 0)::int`,
      firstTryCorrectCount: sql<number>`coalesce(${learningProgress.firstTryCorrectCount}, 0)::int`,
      assistedCount: sql<number>`coalesce(${learningProgress.assistedCount}, 0)::int`,
      lastPracticedAt: learningProgress.lastPracticedAt,
    })
    .from(vocabularyItems)
    .leftJoin(
      learningProgress,
      eq(learningProgress.vocabularyItemId, vocabularyItems.id),
    )
    .where(and(...filters))
    .orderBy(desc(vocabularyItems.createdAt), desc(vocabularyItems.id))
    .limit(input.limit + 1);

  const hasNextPage = rows.length > input.limit;
  const pageRows = rows.slice(0, input.limit);
  const cursorRow = hasNextPage ? pageRows.at(-1) : undefined;
  return VocabularyPageSchema.parse({
    items: pageRows.map((row) => ({
      id: row.id,
      term: row.term,
      meaningZh: row.meaningZh,
      sourceSentence: row.sourceSentence,
      status: row.status,
      practiceCount: row.practiceCount,
      firstTryCorrectCount: row.firstTryCorrectCount,
      assistedCount: row.assistedCount,
      lastPracticedAt: row.lastPracticedAt?.toISOString() ?? null,
    })),
    nextCursor: cursorRow
      ? encodeCursor({ createdAt: cursorRow.createdAtCursor, id: cursorRow.id })
      : null,
  });
}

function decodeCursor(value: string): VocabularyCursor {
  if (
    value.length === 0 ||
    value.length > CURSOR_MAX_LENGTH ||
    !CURSOR_PATTERN.test(value)
  ) {
    throw invalidCursor();
  }

  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw invalidCursor();
    const parsed = CursorPayloadSchema.safeParse(
      JSON.parse(bytes.toString('utf8')),
    );
    if (!parsed.success) throw invalidCursor();
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidCursor();
  }
}

function encodeCursor(cursor: VocabularyCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

async function assertKnownCursor(
  db: AppDatabase,
  userId: string,
  cursor: VocabularyCursor,
): Promise<void> {
  const [item] = await db
    .select({ id: vocabularyItems.id })
    .from(vocabularyItems)
    .where(
      and(
        eq(vocabularyItems.userId, userId),
        eq(vocabularyItems.id, cursor.id),
        isNull(vocabularyItems.deletedAt),
        sql`${vocabularyItems.createdAt} = ${cursor.createdAt}::timestamptz`,
      ),
    )
    .limit(1);
  if (!item) throw invalidCursor();
}

function olderThanCursor(cursor: VocabularyCursor): SQL {
  return or(
    sql`${vocabularyItems.createdAt} < ${cursor.createdAt}::timestamptz`,
    and(
      sql`${vocabularyItems.createdAt} = ${cursor.createdAt}::timestamptz`,
      lt(vocabularyItems.id, cursor.id),
    ),
  )!;
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_ERROR', '词库游标格式无效', 400);
}

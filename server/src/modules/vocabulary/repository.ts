import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { VocabularyInput } from '@context-reader/contracts';

import { AppError } from '../../core/errors';
import type { AppTransaction } from '../../db/client';
import { vocabularyItems } from '../../db/schema';
import {
  normalizeMeaningZh,
  normalizeTerm,
  vocabularyFingerprint,
} from './normalize';

interface PreparedVocabularyItem {
  term: string;
  normalizedTerm: string;
  meaningZh: string;
  normalizedMeaningZh: string;
  sourceSentence?: string;
  fingerprint: string;
}

export async function upsertExactVocabularyItems(
  tx: AppTransaction,
  userId: string,
  items: readonly VocabularyInput[],
): Promise<string[]> {
  if (items.length === 0) return [];

  const prepared: PreparedVocabularyItem[] = items.map((item) => ({
    term: item.term.trim(),
    normalizedTerm: normalizeTerm(item.term),
    meaningZh: item.meaningZh.trim(),
    normalizedMeaningZh: normalizeMeaningZh(item.meaningZh),
    ...(item.sourceSentence === undefined
      ? {}
      : { sourceSentence: item.sourceSentence.trim() }),
    fingerprint: vocabularyFingerprint(item.term, item.meaningZh),
  }));

  await tx
    .insert(vocabularyItems)
    .values(
      prepared.map((item) => ({
        userId,
        ...item,
      })),
    )
    .onConflictDoNothing();

  const fingerprints = prepared.map(({ fingerprint }) => fingerprint);
  const activeItems = await tx
    .select({ id: vocabularyItems.id, fingerprint: vocabularyItems.fingerprint })
    .from(vocabularyItems)
    .where(
      and(
        eq(vocabularyItems.userId, userId),
        inArray(vocabularyItems.fingerprint, fingerprints),
        isNull(vocabularyItems.deletedAt),
      ),
    );
  const idsByFingerprint = new Map(
    activeItems.map((item) => [item.fingerprint, item.id]),
  );

  return prepared.map(({ fingerprint }) => {
    const id = idsByFingerprint.get(fingerprint);
    if (!id) {
      throw new AppError('INTERNAL_ERROR', '词义保存失败', 500, true);
    }
    return id;
  });
}

/** Pick active review targets on the server without exposing the selection. */
export async function selectRandomReviewVocabularyItemIds(
  tx: AppTransaction,
  userId: string,
  targetCount: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: vocabularyItems.id })
    .from(vocabularyItems)
    .where(
      and(
        eq(vocabularyItems.userId, userId),
        inArray(vocabularyItems.status, ['pending', 'reviewing']),
        isNull(vocabularyItems.deletedAt),
      ),
    )
    .orderBy(sql`random()`)
    .limit(targetCount);

  return rows.map(({ id }) => id);
}

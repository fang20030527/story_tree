import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AppTransaction } from '../../db/client';
import {
  answerAttempts, assistanceEvents, practiceQuestions, practiceTargets,
  vocabularyItems, vocabularyWords, wordReviewEvents,
} from '../../db/schema';
import { consolidateReviews, replayReviews, REVIEW_MODEL_VERSION, reviewPriority, type WordReviewState } from './scheduler';

type Context = typeof vocabularyItems.$inferSelect;
type Word = typeof vocabularyWords.$inferSelect;
export interface RankedWord {
  word: Word;
  state: WordReviewState;
  contexts: Context[];
  targetContext: Context;
  priority: ReturnType<typeof reviewPriority>;
}

/** Every writer/read-backfill takes the same transaction lock before touching words. */
export async function lockVocabulary(tx: AppTransaction, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 918))`);
}

export async function refreshWordReview(tx: AppTransaction, userId: string, word: Word): Promise<WordReviewState> {
  const evidence = await tx.select({
    answerId: answerAttempts.id,
    practiceId: answerAttempts.practiceSessionId,
    vocabularyItemId: practiceTargets.vocabularyItemId,
    submittedAt: answerAttempts.submittedAt,
    isCorrect: answerAttempts.isCorrect,
    wasAssisted: answerAttempts.wasAssisted,
    wordHint: sql<boolean>`exists (
      select 1 from ${assistanceEvents}
      where ${assistanceEvents.userId} = ${userId}
        and ${assistanceEvents.practiceSessionId} = ${answerAttempts.practiceSessionId}
        and ${assistanceEvents.practiceTargetId} = ${practiceTargets.id}
        and ${assistanceEvents.kind} = 'word_hint'
        and ${assistanceEvents.shownAt} <= ${answerAttempts.submittedAt}
    )`,
  }).from(answerAttempts)
    .innerJoin(practiceQuestions, eq(practiceQuestions.id, answerAttempts.practiceQuestionId))
    .innerJoin(practiceTargets, eq(practiceTargets.id, practiceQuestions.practiceTargetId))
    .innerJoin(vocabularyItems, eq(vocabularyItems.id, practiceTargets.vocabularyItemId))
    .where(and(eq(answerAttempts.userId, userId), eq(vocabularyItems.userId, userId), eq(vocabularyItems.wordId, word.id)));
  const state = replayReviews(evidence, word.createdAt);
  await tx.update(vocabularyWords).set({ reviewState: state, updatedAt: new Date() })
    .where(and(eq(vocabularyWords.id, word.id), eq(vocabularyWords.userId, userId)));
  // These events are a rebuildable projection; original answers/context references remain intact.
  await tx.delete(wordReviewEvents).where(eq(wordReviewEvents.wordId, word.id));
  const events = consolidateReviews(evidence);
  if (events.length) await tx.insert(wordReviewEvents).values(events.map((event) => ({
    wordId: word.id, practiceId: event.practiceId, vocabularyItemId: event.vocabularyItemId,
    outcome: event.outcome, wasAssisted: event.wasAssisted, reviewedAt: new Date(event.reviewedAt),
  })));
  return state;
}

/** Also upgrades legacy rows lazily, without interpreting old status labels as recall evidence. */
export async function syncVocabularyWords(tx: AppTransaction, userId: string) {
  await lockVocabulary(tx, userId);
  const contexts = await tx.select().from(vocabularyItems)
    .where(eq(vocabularyItems.userId, userId))
    .orderBy(desc(vocabularyItems.createdAt), desc(vocabularyItems.id));
  let words = await tx.select().from(vocabularyWords).where(eq(vocabularyWords.userId, userId));
  const known = new Set(words.map((word) => word.normalizedTerm));
  const missing = new Map<string, Date>();
  for (const context of contexts) {
    if (!known.has(context.normalizedTerm)) missing.set(context.normalizedTerm, context.createdAt);
  }
  if (missing.size) {
    await tx.insert(vocabularyWords).values([...missing].map(([normalizedTerm, createdAt]) => ({ userId, normalizedTerm, createdAt, reviewState: replayReviews([], createdAt) })))
      .onConflictDoNothing();
    words = await tx.select().from(vocabularyWords).where(eq(vocabularyWords.userId, userId));
  }
  const byTerm = new Map(words.map((word) => [word.normalizedTerm, word]));
  const links = new Map<string, string[]>();
  for (const context of contexts) {
    const word = byTerm.get(context.normalizedTerm)!;
    if (context.wordId !== word.id) {
      const ids = links.get(word.id) ?? [];
      ids.push(context.id);
      links.set(word.id, ids);
      context.wordId = word.id;
    }
  }
  for (const [wordId, ids] of links) {
    await tx.update(vocabularyItems).set({ wordId })
      .where(and(eq(vocabularyItems.userId, userId), inArray(vocabularyItems.id, ids)));
  }
  const answerCounts = await tx.select({
    wordId: vocabularyItems.wordId,
    count: sql<number>`count(*)::int`,
  }).from(answerAttempts)
    .innerJoin(practiceQuestions, eq(practiceQuestions.id, answerAttempts.practiceQuestionId))
    .innerJoin(practiceTargets, eq(practiceTargets.id, practiceQuestions.practiceTargetId))
    .innerJoin(vocabularyItems, eq(vocabularyItems.id, practiceTargets.vocabularyItemId))
    .where(and(eq(answerAttempts.userId, userId), eq(vocabularyItems.userId, userId)))
    .groupBy(vocabularyItems.wordId);
  const counts = new Map(answerCounts.map((row) => [row.wordId, row.count]));
  const unpracticed: Word[] = [];
  for (const word of words) {
    if (!word.reviewState || word.reviewState.version !== REVIEW_MODEL_VERSION || word.reviewState.answerCount !== (counts.get(word.id) ?? 0)) {
      if (!counts.get(word.id)) {
        word.reviewState = replayReviews([], word.createdAt);
        unpracticed.push(word);
      } else word.reviewState = await refreshWordReview(tx, userId, word);
    }
  }
  if (unpracticed.length) await tx.insert(vocabularyWords).values(unpracticed)
    .onConflictDoUpdate({ target: vocabularyWords.id, set: { reviewState: sql`excluded.review_state`, updatedAt: new Date() } });
  return { words, contexts };
}

export async function loadRankedWords(tx: AppTransaction, userId: string, now: Date): Promise<RankedWord[]> {
  const { words, contexts } = await syncVocabularyWords(tx, userId);
  const grouped = new Map<string, Context[]>();
  for (const context of contexts) {
    if (context.deletedAt || !context.wordId) continue;
    const group = grouped.get(context.wordId) ?? [];
    group.push(context);
    grouped.set(context.wordId, group);
  }
  const ranked: RankedWord[] = [];
  for (const word of words) {
    const active = grouped.get(word.id);
    if (!active?.length || !word.reviewState) continue;
    ranked.push({ word, state: word.reviewState, contexts: active,
      targetContext: active.find((context) => context.id === word.reviewState?.lastFailedContextId) ?? active[0]!,
      priority: reviewPriority(word.reviewState, now),
    });
  }
  return ranked.sort((a, b) => a.priority.group - b.priority.group ||
    (a.priority.group === 1 ? a.priority.retrievability - b.priority.retrievability : 0) ||
    a.priority.due - b.priority.due || a.word.id.localeCompare(b.word.id));
}

export async function selectReviewVocabularyItemIds(tx: AppTransaction, userId: string, count: number): Promise<string[]> {
  const words = await loadRankedWords(tx, userId, new Date());
  return words.filter((entry) => entry.priority.group < 2).slice(0, count).map((entry) => entry.targetContext.id);
}

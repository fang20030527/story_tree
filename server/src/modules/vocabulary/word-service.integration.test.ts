import { readFile } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { VocabularyWordPageSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import type { AppDatabase } from '../../db/client';
import {
  answerAttempts, learningProgress, practiceParagraphs, practiceQuestions,
  practiceSessions, practiceTargets, vocabularyItems, vocabularyWords,
  wordReviewEvents, type QuestionOption,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import { submitFirstAnswer } from '../practice/answer-service';
import { recordAssistance } from '../practice/assistance-service';
import { normalizeMeaningZh, normalizeTerm, vocabularyFingerprint } from './normalize';
import { upsertExactVocabularyItems } from './repository';
import { getVocabularyWordContexts, getVocabularyWordPage } from './word-service';
import { loadRankedWords, selectReviewVocabularyItemIds, syncVocabularyWords } from './word-state';

const DAY = 86_400_000;
const NOW = new Date('2026-09-01T12:00:00.000Z');
const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db', EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000', FREE_PRACTICE_LIMIT: '3',
});

describe('word-level vocabulary review', () => {
  it('counts normalized words once, retains saved meanings, and does not reset a schedule for a new meaning', async () => {
    await withTestDatabase(async ({ db }) => {
      const owner = await registerAnonymous(db, 'c1'.repeat(32), true);
      const ids = await db.transaction((tx) => upsertExactVocabularyItems(tx, owner.userId, [
        { term: ' BANK ', meaningZh: '银行', sourceSentence: 'She went to the bank.' },
        { term: 'ｂａｎｋ', meaningZh: '河岸', sourceSentence: 'They walked along the bank.' },
      ]));
      const page = await getVocabularyWordPage(db, pageInput(owner.userId));
      expect(page.summary).toEqual({ totalCount: 1, dueCount: 1, scheduledCount: 0 });
      expect(page.items[0]).toMatchObject({ contextCount: 2, reviewReason: 'new', practiceCount: 0 });
      const wordId = page.items[0]!.wordId;
      const contexts = await getVocabularyWordContexts(db, owner.userId, wordId);
      expect(contexts.contexts).toEqual(expect.arrayContaining([
        { id: ids[0], meaningZh: '银行', sourceSentence: 'She went to the bank.' },
        { id: ids[1], meaningZh: '河岸', sourceSentence: 'They walked along the bank.' },
      ]));
      const practice = await seedPractice(db, owner.userId, [ids[0]!]);
      await submitFirstAnswer(db, answerInput(owner.userId, practice, 0, 'save-first-answer'));
      const [before] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.id, wordId));
      await db.transaction((tx) => upsertExactVocabularyItems(tx, owner.userId, [
        { term: 'bank', meaningZh: '储备库', sourceSentence: 'The hospital has a blood bank.' },
      ]));
      const [after] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.id, wordId));
      expect(after!.reviewState).toEqual(before!.reviewState);
      const updated = await getVocabularyWordPage(db, pageInput(owner.userId));
      expect(updated.summary.totalCount).toBe(1);
      expect(updated.items[0]).toMatchObject({ wordId, contextCount: 3, meaningZh: '储备库', practiceCount: 1 });
    });
  }, 120_000);

  it('uses full-library totals and stable priority pagination, with mutually exclusive due boundaries', async () => {
    await withTestDatabase(async ({ db }) => {
      const owner = await registerAnonymous(db, 'c2'.repeat(32), true);
      const contexts = await seedContexts(db, owner.userId, [
        ...Array.from({ length: 52 }, (_, index) => ({ term: `newword${index}`, meaningZh: `新词${index}` })),
        { term: 'weaker', meaningZh: '更易遗忘' },
        { term: 'stronger', meaningZh: '最近回忆过' },
        { term: 'later', meaningZh: '尚未到期' },
      ]);
      const practice = await seedPractice(db, owner.userId, contexts.slice(52).map((context) => context.id));
      await insertHistoricalAnswers(db, owner.userId, practice, [
        { index: 0, at: new Date(+NOW - 30 * DAY), correct: true },
        { index: 1, at: new Date(+NOW - DAY), correct: true },
        { index: 2, at: new Date(+NOW - 60_000), correct: true },
      ]);
      const first = await getVocabularyWordPage(db, { ...pageInput(owner.userId, NOW), limit: 20 });
      expect(first.items).toHaveLength(20);
      expect(first.summary).toEqual({ totalCount: 55, dueCount: 54, scheduledCount: 1 });
      expect(first.items.every((word) => word.reviewReason === 'new')).toBe(true);
      expect(first.nextCursor).not.toBeNull();
      const second = await getVocabularyWordPage(db, {
        ...pageInput(owner.userId, new Date(+NOW + 60_000)), limit: 20, cursor: first.nextCursor,
      });
      const third = await getVocabularyWordPage(db, {
        ...pageInput(owner.userId, new Date(+NOW + 120_000)), limit: 20, cursor: second.nextCursor,
      });
      expect(second.evaluatedAt).toBe(NOW.toISOString());
      expect(third.evaluatedAt).toBe(NOW.toISOString());
      expect(third.nextCursor).toBeNull();
      const all = [...first.items, ...second.items, ...third.items];
      expect(new Set(all.map((word) => word.wordId)).size).toBe(55);
      expect(all.slice(0, 52).every((word) => word.reviewReason === 'new')).toBe(true);
      expect(all.slice(52).map((word) => word.term)).toEqual(['weaker', 'stronger', 'later']);
      const newIds = all.slice(0, 52).map((word) => word.wordId);
      expect(newIds).toEqual([...newIds].sort());

      const due = await getVocabularyWordPage(db, { ...pageInput(owner.userId, NOW), filter: 'due', limit: 50 });
      const dueTail = await getVocabularyWordPage(db, {
        ...pageInput(owner.userId, NOW), filter: 'due', limit: 50, cursor: due.nextCursor,
      });
      const scheduled = await getVocabularyWordPage(db, { ...pageInput(owner.userId, NOW), filter: 'scheduled' });
      expect([...due.items, ...dueTail.items].map((word) => word.wordId)).toEqual(all.slice(0, 54).map((word) => word.wordId));
      expect(scheduled.items.map((word) => word.term)).toEqual(['later']);
      expect(scheduled.summary).toEqual(first.summary);
      expect(first.nextRefreshAt).toBe(scheduled.items[0]!.nextReviewAt);
      const deadline = Date.parse(scheduled.items[0]!.nextReviewAt);
      const justBefore = await getVocabularyWordPage(db, pageInput(owner.userId, new Date(deadline - 1)));
      const atDeadline = await getVocabularyWordPage(db, pageInput(owner.userId, new Date(deadline)));
      expect(justBefore.summary).toEqual(first.summary);
      expect(atDeadline.summary).toEqual({ totalCount: 55, dueCount: 55, scheduledCount: 0 });
    });
  }, 120_000);

  it('selects one due context per word, preferring the latest failed meaning and excluding future words', async () => {
    await withTestDatabase(async ({ db }) => {
      const owner = await registerAnonymous(db, 'c3'.repeat(32), true);
      const contexts = await seedContexts(db, owner.userId, [
        { term: 'bank', meaningZh: '银行', createdAt: new Date(+NOW - 80 * DAY) },
        { term: 'bank', meaningZh: '河岸', createdAt: new Date(+NOW - 70 * DAY) },
        { term: 'fresh', meaningZh: '新的' },
        { term: 'later', meaningZh: '稍后' },
      ]);
      const practice = await seedPractice(db, owner.userId, [contexts[0]!.id, contexts[3]!.id]);
      await insertHistoricalAnswers(db, owner.userId, practice, [
        { index: 0, at: new Date(Date.now() - DAY), correct: false },
        // A future historical timestamp keeps this fixture independent of wall-clock speed.
        { index: 1, at: new Date(Date.now() + DAY), correct: true },
      ]);
      const ranked = await db.transaction((tx) => loadRankedWords(tx, owner.userId, new Date()));
      expect(ranked.map((word) => word.word.normalizedTerm)).toEqual(['fresh', 'bank', 'later']);
      expect(ranked[1]!.contexts[0]!.id).toBe(contexts[1]!.id);
      expect(ranked[1]!.targetContext.id).toBe(contexts[0]!.id);
      const selection = await db.transaction((tx) => selectReviewVocabularyItemIds(tx, owner.userId, 10));
      expect(selection).toEqual([contexts[2]!.id, contexts[0]!.id]);
    });
  }, 120_000);

  it('rejects foreign contexts/cursors and invalid HTTP filters, and invalidates cursors after word updates', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = 'c4'.repeat(32);
      const otherToken = 'c5'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const other = await registerAnonymous(db, otherToken, true);
      await seedContexts(db, owner.userId, [{ term: 'bank', meaningZh: '银行' }, { term: 'river', meaningZh: '河流' }]);
      await seedContexts(db, other.userId, [{ term: 'bank', meaningZh: '河岸' }]);
      const first = await getVocabularyWordPage(db, { ...pageInput(owner.userId), limit: 1 });
      const foreignPage = await getVocabularyWordPage(db, pageInput(other.userId));
      expect(foreignPage.summary.totalCount).toBe(1);
      expect(foreignPage.items[0]!.wordId).not.toBe(first.items[0]!.wordId);
      const app = buildApp({ config, db, logger: false });
      try {
        const invalidFilter = await app.inject({
          method: 'GET', url: '/v1/vocabulary-words?filter=mastered', headers: { authorization: `Bearer ${token}` },
        });
        expect(invalidFilter.statusCode).toBe(400);
        expect(invalidFilter.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
        const foreignContexts = await app.inject({
          method: 'GET', url: `/v1/vocabulary-words/${first.items[0]!.wordId}/contexts`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(foreignContexts.statusCode).toBe(404);
        const foreignCursor = await app.inject({
          method: 'GET', url: `/v1/vocabulary-words?cursor=${first.nextCursor}`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(foreignCursor.statusCode).toBe(400);
        const valid = await app.inject({
          method: 'GET', url: '/v1/vocabulary-words?filter=due', headers: { authorization: `Bearer ${token}` },
        });
        expect(valid.statusCode).toBe(200);
        expect(VocabularyWordPageSchema.parse(valid.json()).summary.totalCount).toBe(2);
      } finally { await app.close(); }
      await expect(getVocabularyWordPage(db, {
        ...pageInput(owner.userId), filter: 'due', cursor: first.nextCursor,
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(getVocabularyWordPage(db, {
        ...pageInput(owner.userId), cursor: 'not-a-valid-cursor',
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      const [word] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.id, first.items[0]!.wordId));
      await db.update(vocabularyWords).set({
        reviewState: { ...word!.reviewState!, nextReviewAt: new Date(Date.now() + DAY).toISOString() },
      }).where(eq(vocabularyWords.id, word!.id));
      await expect(getVocabularyWordPage(db, {
        ...pageInput(owner.userId), cursor: first.nextCursor,
      })).rejects.toMatchObject({ code: 'VOCABULARY_CHANGED', statusCode: 409 });
    });
  }, 120_000);

  it('backfills legacy identities idempotently and replays one weakest result without losing historical references', async () => {
    await withTestDatabase(async ({ db }) => {
      const owner = await registerAnonymous(db, 'c6'.repeat(32), true);
      const contexts = await seedContexts(db, owner.userId, [
        { term: 'bank', meaningZh: '银行', status: 'mastered' },
        { term: 'bank', meaningZh: '河岸', status: 'reviewing' },
        { term: 'untested', meaningZh: '未验证', status: 'self_reported' },
      ]);
      await db.insert(learningProgress).values({
        vocabularyItemId: contexts[2]!.id, practiceCount: 20, firstTryCorrectCount: 20,
      });
      const practice = await seedPractice(db, owner.userId, contexts.slice(0, 2).map((context) => context.id));
      const answerIds = await insertHistoricalAnswers(db, owner.userId, practice, [
        { index: 0, at: new Date(+NOW - 2 * DAY), correct: true },
        { index: 1, at: new Date(+NOW - 2 * DAY + 60_000), correct: false },
      ]);
      expect(await db.select().from(vocabularyWords)).toHaveLength(0);
      const migration = await readFile(new URL('../../../drizzle/0005_careful_squirrel_girl.sql', import.meta.url), 'utf8');
      const backfill = migration.slice(migration.indexOf('INSERT INTO "vocabulary_words"'));
      await db.execute(sql.raw(backfill));
      await db.execute(sql.raw(backfill));
      expect(await db.select().from(vocabularyWords)).toHaveLength(2);
      const page = await getVocabularyWordPage(db, pageInput(owner.userId, NOW));
      expect(page.summary).toEqual({ totalCount: 2, dueCount: 2, scheduledCount: 0 });
      expect(page.items.find((word) => word.term === 'untested')).toMatchObject({ practiceCount: 0, reviewReason: 'new' });
      const bank = page.items.find((word) => word.term === 'bank')!;
      expect(bank).toMatchObject({ contextCount: 2, practiceCount: 1, independentCorrectCount: 0, reviewReason: 'relearn' });
      const [word] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.id, bank.wordId));
      expect(word!.reviewState).toMatchObject({ answerCount: 2, practiceCount: 1, lastFailedContextId: contexts[1]!.id });
      expect(word!.reviewState!.card.reps).toBe(1);
      await db.execute(sql.raw(backfill));
      expect((await db.select().from(vocabularyWords).where(eq(vocabularyWords.id, bank.wordId)))[0]!.reviewState).toEqual(word!.reviewState);
      const events = await db.select().from(wordReviewEvents).where(eq(wordReviewEvents.wordId, bank.wordId));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ practiceId: practice.id, vocabularyItemId: contexts[1]!.id, outcome: 'failed' });

      // Force a rebuild, then run the lazy migration again to exercise both paths.
      await db.update(vocabularyWords).set({ reviewState: null }).where(eq(vocabularyWords.id, bank.wordId));
      await db.transaction((tx) => syncVocabularyWords(tx, owner.userId));
      await db.transaction((tx) => syncVocabularyWords(tx, owner.userId));
      const [rebuilt] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.id, bank.wordId));
      expect(rebuilt!.reviewState).toEqual(word!.reviewState);
      expect(await db.select().from(wordReviewEvents).where(eq(wordReviewEvents.wordId, bank.wordId))).toEqual(events);
      const preservedContexts = await db.select().from(vocabularyItems).where(eq(vocabularyItems.userId, owner.userId));
      expect(preservedContexts.map((context) => context.id).sort()).toEqual(contexts.map((context) => context.id).sort());
      expect(preservedContexts.every((context) => context.wordId !== null)).toBe(true);
      const preservedAnswers = await db.select().from(answerAttempts).where(eq(answerAttempts.userId, owner.userId));
      expect(preservedAnswers.map((answer) => answer.id).sort()).toEqual([...answerIds].sort());
      expect(await db.select().from(learningProgress)).toEqual([expect.objectContaining({ practiceCount: 20, firstTryCorrectCount: 20 })]);
    });
  }, 120_000);

  it('keeps first answers idempotent and consolidates old multi-meaning practices while concurrent practices retain both updates', async () => {
    await withTestDatabase(async ({ db }) => {
      const owner = await registerAnonymous(db, 'c7'.repeat(32), true);
      const contexts = await seedContexts(db, owner.userId, [{ term: 'bank', meaningZh: '银行' }, { term: 'bank', meaningZh: '河岸' }]);
      const oldPractice = await seedPractice(db, owner.userId, contexts.map((context) => context.id));
      const firstInput = answerInput(owner.userId, oldPractice, 0, 'concurrent-first-answer');
      const first = await submitFirstAnswer(db, firstInput);
      expect(await submitFirstAnswer(db, firstInput)).toEqual(first);
      expect(await submitFirstAnswer(db, { ...firstInput, idempotencyKey: 'same-question-new-key' })).toEqual(first);
      const afterFirst = await getVocabularyWordPage(db, pageInput(owner.userId));
      expect(afterFirst.items[0]).toMatchObject({ practiceCount: 1, independentCorrectCount: 1 });
      await submitFirstAnswer(db, {
        ...answerInput(owner.userId, oldPractice, 1, 'old-second-meaning'),
        selectedOptionId: oldPractice.targets[1]!.wrongOptionId,
      });
      const afterFailure = await getVocabularyWordPage(db, pageInput(owner.userId));
      expect(afterFailure.items[0]).toMatchObject({ practiceCount: 1, independentCorrectCount: 0 });
      const [consolidated] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.userId, owner.userId));
      expect(consolidated!.reviewState!.card.reps).toBe(1);
      expect(consolidated!.reviewState!.lastFailedContextId).toBe(contexts[1]!.id);

      const practiceA = await seedPractice(db, owner.userId, [contexts[0]!.id]);
      const practiceB = await seedPractice(db, owner.userId, [contexts[1]!.id]);
      const results = await Promise.all([
        submitFirstAnswer(db, answerInput(owner.userId, practiceA, 0, 'parallel-practice-a')),
        submitFirstAnswer(db, answerInput(owner.userId, practiceB, 0, 'parallel-practice-b')),
      ]);
      expect(results.every((result) => result.isCorrect && !result.wasAssisted)).toBe(true);
      const final = await getVocabularyWordPage(db, pageInput(owner.userId));
      expect(final.items[0]).toMatchObject({ practiceCount: 3, independentCorrectCount: 2, contextCount: 2 });
      const [stored] = await db.select().from(vocabularyWords).where(eq(vocabularyWords.userId, owner.userId));
      expect(stored!.reviewState!.answerCount).toBe(4);
      expect(await db.select().from(wordReviewEvents).where(eq(wordReviewEvents.wordId, stored!.id))).toHaveLength(3);
      expect(await db.select().from(answerAttempts).where(eq(answerAttempts.userId, owner.userId))).toHaveLength(4);
    });
  }, 120_000);

  it('maps real assistance scopes conservatively and does not change a first answer after later help', async () => {
    await withTestDatabase(async ({ db }) => {
      const owner = await registerAnonymous(db, 'c8'.repeat(32), true);
      const contexts = await seedContexts(db, owner.userId, [
        { term: 'independent', meaningZh: '独立回忆' }, { term: 'hinted', meaningZh: '看过提示' },
        { term: 'paragraph', meaningZh: '段落翻译' }, { term: 'full', meaningZh: '全文翻译' },
        { term: 'unknown', meaningZh: '不认识' }, { term: 'incorrect', meaningZh: '答错' },
      ]);
      const practice = await seedPractice(db, owner.userId, contexts.map((context) => context.id));
      await submitFirstAnswer(db, answerInput(owner.userId, practice, 0, 'independent-answer'));
      const beforeHelp = await db.select().from(vocabularyWords).where(eq(vocabularyWords.userId, owner.userId));
      const originalState = beforeHelp.find((word) => word.normalizedTerm === 'independent')!.reviewState;
      for (const index of [0, 1]) await recordAssistance(db, {
        userId: owner.userId, practiceId: practice.id, idempotencyKey: `target-hint-${index}`,
        request: { kind: 'word_hint', targetId: practice.targets[index]!.id },
      });
      await submitFirstAnswer(db, answerInput(owner.userId, practice, 1, 'hinted-answer'));
      await recordAssistance(db, {
        userId: owner.userId, practiceId: practice.id, idempotencyKey: 'paragraph-translation-help',
        request: { kind: 'paragraph_translation', paragraphId: practice.targets[2]!.paragraphId },
      });
      await submitFirstAnswer(db, answerInput(owner.userId, practice, 2, 'paragraph-answer'));
      await recordAssistance(db, {
        userId: owner.userId, practiceId: practice.id, idempotencyKey: 'full-translation-help', request: { kind: 'full_translation' },
      });
      await submitFirstAnswer(db, answerInput(owner.userId, practice, 3, 'full-answer'));
      await submitFirstAnswer(db, {
        userId: owner.userId, practiceId: practice.id, questionId: practice.targets[4]!.questionId,
        answerKind: 'dont_know', elapsedMs: 300, idempotencyKey: 'unknown-answer',
      });
      await submitFirstAnswer(db, {
        ...answerInput(owner.userId, practice, 5, 'incorrect-answer'), selectedOptionId: practice.targets[5]!.wrongOptionId,
      });
      const stored = await db.select().from(vocabularyWords).where(eq(vocabularyWords.userId, owner.userId));
      const stateOf = (term: string) => stored.find((word) => word.normalizedTerm === term)!.reviewState!;
      expect(stateOf('independent')).toEqual(originalState);
      expect(stateOf('hinted')).toMatchObject({ lastOutcome: 'failed', independentCorrectCount: 0, assistedCount: 1 });
      for (const term of ['paragraph', 'full']) {
        const state = stateOf(term);
        expect(state).toMatchObject({ lastOutcome: 'translated', independentCorrectCount: 0, practiceCount: 1, assistedCount: 1 });
        expect(state.card.stability).toBe(0);
        expect(state.card.reps).toBe(0);
        expect(Date.parse(state.nextReviewAt) - Date.parse(state.lastPracticedAt!)).toBe(DAY);
      }
      for (const term of ['unknown', 'incorrect']) expect(stateOf(term)).toMatchObject({ lastOutcome: 'failed', assistedCount: 1 });
    });
  }, 120_000);
});

function pageInput(userId: string, now = new Date()) {
  return { userId, filter: 'all' as const, limit: 20, cursor: null, now };
}

async function seedContexts(db: AppDatabase, userId: string, items: {
  term: string; meaningZh: string; createdAt?: Date; status?: 'pending' | 'reviewing' | 'mastered' | 'self_reported';
}[]) {
  return db.insert(vocabularyItems).values(items.map((item) => ({
    id: crypto.randomUUID(), userId, term: item.term, meaningZh: item.meaningZh,
    normalizedTerm: normalizeTerm(item.term), normalizedMeaningZh: normalizeMeaningZh(item.meaningZh),
    sourceSentence: `The article uses ${item.term} in context.`,
    fingerprint: vocabularyFingerprint(item.term, item.meaningZh),
    status: item.status ?? 'pending', createdAt: item.createdAt ?? new Date(+NOW - 90 * DAY),
  }))).returning();
}

interface SeededPractice {
  id: string;
  targets: { id: string; paragraphId: string; questionId: string; correctOptionId: string; wrongOptionId: string }[];
}

async function seedPractice(db: AppDatabase, userId: string, contextIds: string[]): Promise<SeededPractice> {
  const id = crypto.randomUUID();
  const targets = contextIds.map(() => ({
    id: crypto.randomUUID(), paragraphId: crypto.randomUUID(), questionId: crypto.randomUUID(),
    correctOptionId: crypto.randomUUID(), wrongOptionId: crypto.randomUUID(),
  }));
  await db.transaction(async (tx) => {
    await tx.insert(practiceSessions).values({
      id, userId, examPath: 'ielts', status: 'ready', articleTitle: 'Words in context',
      articleWordCount: 700, modelName: 'test', promptVersion: 'test-v1', readyAt: new Date(),
    });
    await tx.insert(practiceParagraphs).values(targets.map((target, position) => ({
      id: target.paragraphId, practiceSessionId: id, position, plainText: 'A saved word in context.',
    })));
    await tx.insert(practiceTargets).values(targets.map((target, position) => ({
      id: target.id, practiceSessionId: id, vocabularyItemId: contextIds[position]!, position,
      paragraphId: target.paragraphId, surfaceForm: 'word', startOffset: 8, endOffset: 12,
    })));
    await tx.insert(practiceQuestions).values(targets.map((target) => {
      const options: QuestionOption[] = [
        { id: target.correctOptionId, label: '正确含义' }, { id: target.wrongOptionId, label: '错误含义' },
        { id: crypto.randomUUID(), label: '干扰含义甲' }, { id: crypto.randomUUID(), label: '干扰含义乙' },
      ];
      return {
        id: target.questionId, practiceTargetId: target.id, prompt: '这个单词在本文中是什么意思？',
        optionsJson: options, correctOptionId: target.correctOptionId, meaningEn: 'meaning in context',
        explanationZh: '根据语境选择正确含义。',
        optionExplanationsJson: Object.fromEntries(options.map((option) => [option.id, '本文语境中的解释。'])),
      };
    }));
  });
  return { id, targets };
}

async function insertHistoricalAnswers(db: AppDatabase, userId: string, practice: SeededPractice,
  answers: { index: number; at: Date; correct: boolean }[]) {
  const rows = answers.map((answer) => ({
    id: crypto.randomUUID(), userId, practiceSessionId: practice.id,
    practiceQuestionId: practice.targets[answer.index]!.questionId, answerKind: 'option' as const,
    selectedOptionId: answer.correct ? practice.targets[answer.index]!.correctOptionId : practice.targets[answer.index]!.wrongOptionId,
    isCorrect: answer.correct, wasAssisted: false, elapsedMs: 300,
    idempotencyKey: `historical-answer-${answer.index}`, submittedAt: answer.at,
  }));
  await db.insert(answerAttempts).values(rows);
  return rows.map((row) => row.id);
}

function answerInput(userId: string, practice: SeededPractice, index: number, idempotencyKey: string) {
  return {
    userId, practiceId: practice.id, questionId: practice.targets[index]!.questionId,
    answerKind: 'option' as const, selectedOptionId: practice.targets[index]!.correctOptionId,
    elapsedMs: 300, idempotencyKey,
  };
}

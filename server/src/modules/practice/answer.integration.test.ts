import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  AnswerResultSchema,
  AssistanceResponseSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  answerAttempts,
  assistanceEvents,
  learningProgress,
  practiceParagraphs,
  practiceQuestions,
  practiceSessions,
  practiceTargets,
  vocabularyItems,
  type QuestionOption,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import {
  normalizeMeaningZh,
  normalizeTerm,
  vocabularyFingerprint,
} from '../vocabulary/normalize';
import { submitFirstAnswer } from './answer-service';
import { recordAssistance } from './assistance-service';
import { getPracticeForUser } from './get-service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
  FREE_PRACTICE_LIMIT: '3',
});

describe('first-answer evidence', () => {
  it('grades assistance once, keeps first outcomes immutable, and completes the practice', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = 'a1'.repeat(32);
      const owner = await registerAnonymous(db, ownerToken, true);
      const other = await registerAnonymous(db, 'a2'.repeat(32), true);
      const seeded = await seedPractice(db, owner.userId);
      const app = buildApp({ config, db, logger: false });

      try {
        const hintResponse = await app.inject({
          method: 'POST',
          url: `/v1/practices/${seeded.practiceId}/assistance`,
          headers: {
            authorization: `Bearer ${ownerToken}`,
            'idempotency-key': 'word-hint-00000001',
          },
          payload: { kind: 'word_hint', targetId: seeded.targets[0]!.id },
        });
        expect(hintResponse.statusCode).toBe(200);
        expect(AssistanceResponseSchema.parse(hintResponse.json())).toEqual({
          recorded: true,
          hintMeaningZh: seeded.targets[0]!.meaningZh,
          sourceSentence: 'The original article introduced resilient.',
        });
        const replayedHint = await app.inject({
          method: 'POST',
          url: `/v1/practices/${seeded.practiceId}/assistance`,
          headers: {
            authorization: `Bearer ${ownerToken}`,
            'idempotency-key': 'word-hint-00000001',
          },
          payload: { kind: 'word_hint', targetId: seeded.targets[0]!.id },
        });
        expect(replayedHint.json()).toEqual(hintResponse.json());

        const firstQuestion = seeded.targets[0]!;
        const firstAnswerResponse = await app.inject({
          method: 'POST',
          url: `/v1/practices/${seeded.practiceId}/answers`,
          headers: {
            authorization: `Bearer ${ownerToken}`,
            'idempotency-key': 'answer-first-000001',
          },
          payload: {
            answerKind: 'option',
            questionId: firstQuestion.questionId,
            selectedOptionId: firstQuestion.correctOptionId,
            elapsedMs: 900,
          },
        });
        expect(firstAnswerResponse.statusCode).toBe(200);
        expect(AnswerResultSchema.parse(firstAnswerResponse.json())).toMatchObject({
          answerKind: 'option',
          isCorrect: true,
          wasAssisted: true,
        });
      } finally {
        await app.close();
      }

      const secondQuestion = seeded.targets[1]!;
      const wrongRequest = {
        userId: owner.userId,
        practiceId: seeded.practiceId,
        questionId: secondQuestion.questionId,
        answerKind: 'option' as const,
        selectedOptionId: secondQuestion.wrongOptionId,
        elapsedMs: 1_200,
      };
      const [wrongFirst, wrongConcurrent] = await Promise.all([
        submitFirstAnswer(db, {
          ...wrongRequest,
          idempotencyKey: 'answer-race-0000001',
        }),
        submitFirstAnswer(db, {
          ...wrongRequest,
          idempotencyKey: 'answer-race-0000002',
        }),
      ]);
      expect(wrongConcurrent).toEqual(wrongFirst);
      expect(wrongFirst).toMatchObject({
        answerKind: 'option',
        selectedOptionId: secondQuestion.wrongOptionId,
        isCorrect: false,
        wasAssisted: false,
        correctOptionId: secondQuestion.correctOptionId,
      });
      expect(Object.keys(wrongFirst.optionExplanations)).toHaveLength(4);

      await recordAssistance(db, {
        userId: owner.userId,
        practiceId: seeded.practiceId,
        request: {
          kind: 'paragraph_translation',
          paragraphId: seeded.paragraphIds[0]!,
        },
        idempotencyKey: 'paragraph-help-0001',
      });
      const afterAssistance = await submitFirstAnswer(db, {
        ...wrongRequest,
        selectedOptionId: secondQuestion.correctOptionId,
        idempotencyKey: 'answer-after-help-01',
      });
      expect(afterAssistance).toEqual(wrongFirst);
      expect(afterAssistance.wasAssisted).toBe(false);

      for (const [index, target] of seeded.targets.slice(2, 4).entries()) {
        const result = await submitFirstAnswer(db, {
          userId: owner.userId,
          practiceId: seeded.practiceId,
          questionId: target.questionId,
          answerKind: 'option',
          selectedOptionId: target.correctOptionId,
          elapsedMs: 1_500 + index,
          idempotencyKey: `paragraph-answer-00${index + 1}`,
        });
        expect(result).toMatchObject({ isCorrect: true, wasAssisted: true });
      }

      await recordAssistance(db, {
        userId: owner.userId,
        practiceId: seeded.practiceId,
        request: { kind: 'full_translation' },
        idempotencyKey: 'full-help-00000001',
      });
      const lastTarget = seeded.targets[4]!;
      const dontKnow = await submitFirstAnswer(db, {
        userId: owner.userId,
        practiceId: seeded.practiceId,
        questionId: lastTarget.questionId,
        answerKind: 'dont_know',
        elapsedMs: 2_000,
        idempotencyKey: 'dont-know-00000001',
      });
      expect(dontKnow).toMatchObject({
        answerKind: 'dont_know',
        selectedOptionId: null,
        isCorrect: false,
        wasAssisted: true,
      });

      const practice = await getPracticeForUser(db, {
        userId: owner.userId,
        practiceId: seeded.practiceId,
        freeLimit: 3,
      });
      expect(practice.status).toBe('completed');
      expect(practice.questions.every((question) => question.submittedAnswer)).toBe(
        true,
      );
      expect(practice.questions[1]?.submittedAnswer?.wasAssisted).toBe(false);

      expect(
        await db
          .select()
          .from(answerAttempts)
          .where(eq(answerAttempts.practiceSessionId, seeded.practiceId)),
      ).toHaveLength(5);
      const [progressTotals] = await db
        .select({
          practiceCount: sql<number>`sum(${learningProgress.practiceCount})::int`,
          correctCount: sql<number>`sum(${learningProgress.firstTryCorrectCount})::int`,
          assistedCount: sql<number>`sum(${learningProgress.assistedCount})::int`,
        })
        .from(learningProgress)
        .innerJoin(
          vocabularyItems,
          eq(vocabularyItems.id, learningProgress.vocabularyItemId),
        )
        .where(eq(vocabularyItems.userId, owner.userId));
      expect(progressTotals).toEqual({
        practiceCount: 5,
        correctCount: 3,
        assistedCount: 4,
      });
      expect(
        await db
          .select()
          .from(assistanceEvents)
          .where(
            and(
              eq(assistanceEvents.userId, owner.userId),
              eq(assistanceEvents.practiceSessionId, seeded.practiceId),
            ),
          ),
      ).toHaveLength(3);

      await expect(
        submitFirstAnswer(db, {
          userId: other.userId,
          practiceId: seeded.practiceId,
          questionId: lastTarget.questionId,
          answerKind: 'dont_know',
          elapsedMs: 100,
          idempotencyKey: 'foreign-answer-0001',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  }, 120_000);
});

interface SeededTarget {
  id: string;
  meaningZh: string;
  questionId: string;
  correctOptionId: string;
  wrongOptionId: string;
}

async function seedPractice(
  db: Parameters<typeof submitFirstAnswer>[0],
  userId: string,
): Promise<{
  practiceId: string;
  paragraphIds: string[];
  targets: SeededTarget[];
}> {
  const practiceId = crypto.randomUUID();
  const paragraphIds = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(practiceSessions).values({
    id: practiceId,
    userId,
    examPath: 'ielts',
    status: 'ready',
    articleTitle: 'Evidence and reflection',
    articleWordCount: 700,
    modelName: 'fake',
    promptVersion: 'test-v1',
    readyAt: new Date(),
  });
  const terms = [
    ['resilient', '有韧性的'],
    ['ambiguous', '模棱两可的'],
    ['meticulous', '一丝不苟的'],
    ['coherent', '连贯的'],
    ['balanced', '均衡的'],
  ] as const;
  const paragraphTexts = [
    terms.slice(0, 4).map(([term]) => term).join(' '),
    terms[4]![0],
  ];
  await db.insert(practiceParagraphs).values(
    paragraphTexts.map((plainText, position) => ({
      id: paragraphIds[position]!,
      practiceSessionId: practiceId,
      position,
      plainText,
    })),
  );

  const seededTargets: SeededTarget[] = [];
  for (const [position, [term, meaningZh]] of terms.entries()) {
    const vocabularyItemId = crypto.randomUUID();
    await db.insert(vocabularyItems).values({
      id: vocabularyItemId,
      userId,
      term,
      normalizedTerm: normalizeTerm(term),
      meaningZh,
      normalizedMeaningZh: normalizeMeaningZh(meaningZh),
      sourceSentence: `The original article introduced ${term}.`,
      fingerprint: vocabularyFingerprint(term, meaningZh),
    });
    const paragraphIndex = position < 4 ? 0 : 1;
    const paragraphText = paragraphTexts[paragraphIndex]!;
    const startOffset = paragraphText.indexOf(term);
    const targetId = crypto.randomUUID();
    await db.insert(practiceTargets).values({
      id: targetId,
      practiceSessionId: practiceId,
      vocabularyItemId,
      position,
      paragraphId: paragraphIds[paragraphIndex],
      surfaceForm: term,
      startOffset,
      endOffset: startOffset + term.length,
    });

    const options: QuestionOption[] = [
      { id: crypto.randomUUID(), label: meaningZh },
      { id: crypto.randomUUID(), label: `干扰项甲${position}` },
      { id: crypto.randomUUID(), label: `干扰项乙${position}` },
      { id: crypto.randomUUID(), label: `干扰项丙${position}` },
    ];
    const questionId = crypto.randomUUID();
    await db.insert(practiceQuestions).values({
      id: questionId,
      practiceTargetId: targetId,
      prompt: `${term} 在本文语境中的含义是什么？`,
      optionsJson: options,
      correctOptionId: options[0]!.id,
      meaningEn: `${term} in context`,
      explanationZh: `正确义项是${meaningZh}。`,
      optionExplanationsJson: Object.fromEntries(
        options.map((option, optionIndex) => [
          option.id,
          optionIndex === 0 ? '符合语境。' : '不符合语境。',
        ]),
      ),
    });
    seededTargets.push({
      id: targetId,
      meaningZh,
      questionId,
      correctOptionId: options[0]!.id,
      wrongOptionId: options[1]!.id,
    });
  }
  return { practiceId, paragraphIds, targets: seededTargets };
}

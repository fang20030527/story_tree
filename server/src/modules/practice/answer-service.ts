import { randomUUID } from 'node:crypto';

import {
  AnswerResultSchema,
  type AnswerResult,
  type PracticeStatus,
} from '@context-reader/contracts';
import { and, eq, lte, or, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  answerAttempts,
  assistanceEvents,
  learningProgress,
  practiceQuestions,
  practiceSessions,
  practiceTargets,
  vocabularyItems,
  type QuestionOption,
} from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { assertPracticeTransition } from './state';
import { lockVocabulary, syncVocabularyWords } from '../vocabulary/word-state';

export type SubmitAnswerInput =
  | {
      userId: string;
      practiceId: string;
      questionId: string;
      answerKind: 'option';
      selectedOptionId: string;
      elapsedMs: number;
      idempotencyKey: string;
    }
  | {
      userId: string;
      practiceId: string;
      questionId: string;
      answerKind: 'dont_know';
      elapsedMs: number;
      idempotencyKey: string;
    };

interface PracticeLock {
  status: PracticeStatus;
  startedAt: Date | null;
}

interface QuestionContext {
  id: string;
  targetId: string;
  vocabularyItemId: string;
  paragraphId: string | null;
  options: QuestionOption[];
  correctOptionId: string;
  meaningEn: string;
  explanationZh: string;
  optionExplanations: Record<string, string>;
}

interface StoredAnswer {
  id: string;
  answerKind: 'option' | 'dont_know';
  selectedOptionId: string | null;
  isCorrect: boolean;
  wasAssisted: boolean;
}

export async function submitFirstAnswer(
  db: AppDatabase,
  input: SubmitAnswerInput,
): Promise<AnswerResult> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'submit_answer',
      input.idempotencyKey,
      answerRequestMaterial(input),
    );
    if (replay) {
      return loadAnswerResult(
        tx,
        input.userId,
        input.practiceId,
        replay,
      );
    }

    await lockVocabulary(tx, input.userId);
    const practice = await lockOwnedPractice(
      tx,
      input.userId,
      input.practiceId,
    );
    const question = await lockPracticeQuestion(
      tx,
      input.practiceId,
      input.questionId,
    );
    const existingAnswer = await lockExistingAnswer(
      tx,
      input.userId,
      question.id,
    );
    if (existingAnswer) {
      await finishIdempotentOperation(
        tx,
        input.userId,
        'submit_answer',
        input.idempotencyKey,
        existingAnswer.id,
      );
      return toAnswerResult(existingAnswer, question);
    }

    assertAnswerable(practice.status);
    const submittedAt = new Date();
    const selection = gradeSelection(input, question.options, question.correctOptionId);
    const wasAssisted = await hasPriorAssistance(
      tx,
      input.userId,
      input.practiceId,
      question,
      submittedAt,
    );
    const answer: StoredAnswer = {
      id: randomUUID(),
      answerKind: input.answerKind,
      selectedOptionId: selection.selectedOptionId,
      isCorrect: selection.isCorrect,
      wasAssisted,
    };

    await tx.insert(answerAttempts).values({
      ...answer,
      practiceSessionId: input.practiceId,
      practiceQuestionId: question.id,
      userId: input.userId,
      elapsedMs: input.elapsedMs,
      idempotencyKey: input.idempotencyKey,
      submittedAt,
    });
    await updateLearningProgress(
      tx,
      input.userId,
      question.vocabularyItemId,
      answer,
      submittedAt,
    );
    await syncVocabularyWords(tx, input.userId);
    await updatePracticeProgress(
      tx,
      input.userId,
      input.practiceId,
      practice,
      submittedAt,
    );
    await finishIdempotentOperation(
      tx,
      input.userId,
      'submit_answer',
      input.idempotencyKey,
      answer.id,
    );

    return toAnswerResult(answer, question);
  });
}

function answerRequestMaterial(input: SubmitAnswerInput): object {
  if (input.answerKind === 'option') {
    return {
      practiceId: input.practiceId,
      answerKind: input.answerKind,
      questionId: input.questionId,
      selectedOptionId: input.selectedOptionId,
      elapsedMs: input.elapsedMs,
    };
  }
  return {
    practiceId: input.practiceId,
    answerKind: input.answerKind,
    questionId: input.questionId,
    elapsedMs: input.elapsedMs,
  };
}

async function lockOwnedPractice(
  tx: AppTransaction,
  userId: string,
  practiceId: string,
): Promise<PracticeLock> {
  const [practice] = await tx
    .select({
      status: practiceSessions.status,
      startedAt: practiceSessions.startedAt,
    })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.id, practiceId),
        eq(practiceSessions.userId, userId),
      ),
    )
    .for('update')
    .limit(1);
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  return practice;
}

async function lockPracticeQuestion(
  tx: AppTransaction,
  practiceId: string,
  questionId: string,
): Promise<QuestionContext> {
  const [question] = await tx
    .select({
      id: practiceQuestions.id,
      targetId: practiceTargets.id,
      vocabularyItemId: practiceTargets.vocabularyItemId,
      paragraphId: practiceTargets.paragraphId,
      options: practiceQuestions.optionsJson,
      correctOptionId: practiceQuestions.correctOptionId,
      meaningEn: practiceQuestions.meaningEn,
      explanationZh: practiceQuestions.explanationZh,
      optionExplanations: practiceQuestions.optionExplanationsJson,
    })
    .from(practiceQuestions)
    .innerJoin(
      practiceTargets,
      eq(practiceTargets.id, practiceQuestions.practiceTargetId),
    )
    .where(
      and(
        eq(practiceQuestions.id, questionId),
        eq(practiceTargets.practiceSessionId, practiceId),
      ),
    )
    .for('update')
    .limit(1);
  if (!question) throw new AppError('NOT_FOUND', '题目不存在', 404);
  return question;
}

async function lockExistingAnswer(
  tx: AppTransaction,
  userId: string,
  questionId: string,
): Promise<StoredAnswer | null> {
  const [answer] = await tx
    .select({
      id: answerAttempts.id,
      answerKind: answerAttempts.answerKind,
      selectedOptionId: answerAttempts.selectedOptionId,
      isCorrect: answerAttempts.isCorrect,
      wasAssisted: answerAttempts.wasAssisted,
    })
    .from(answerAttempts)
    .where(
      and(
        eq(answerAttempts.userId, userId),
        eq(answerAttempts.practiceQuestionId, questionId),
      ),
    )
    .for('update')
    .limit(1);
  return answer ?? null;
}

function assertAnswerable(status: PracticeStatus): void {
  if (status !== 'ready' && status !== 'in_progress') {
    throw new AppError('STATE_CONFLICT', '练习尚不能提交答案', 409);
  }
}

function gradeSelection(
  input: SubmitAnswerInput,
  options: QuestionOption[],
  correctOptionId: string,
): { selectedOptionId: string | null; isCorrect: boolean } {
  if (input.answerKind === 'dont_know') {
    return { selectedOptionId: null, isCorrect: false };
  }
  if (!options.some((option) => option.id === input.selectedOptionId)) {
    throw new AppError('VALIDATION_ERROR', '所选答案无效', 400);
  }
  return {
    selectedOptionId: input.selectedOptionId,
    isCorrect: input.selectedOptionId === correctOptionId,
  };
}

async function hasPriorAssistance(
  tx: AppTransaction,
  userId: string,
  practiceId: string,
  question: QuestionContext,
  submittedAt: Date,
): Promise<boolean> {
  const matchingScope = question.paragraphId
    ? or(
        and(
          eq(assistanceEvents.kind, 'word_hint'),
          eq(assistanceEvents.practiceTargetId, question.targetId),
        ),
        and(
          eq(assistanceEvents.kind, 'paragraph_translation'),
          eq(assistanceEvents.paragraphId, question.paragraphId),
        ),
        eq(assistanceEvents.kind, 'full_translation'),
      )
    : or(
        and(
          eq(assistanceEvents.kind, 'word_hint'),
          eq(assistanceEvents.practiceTargetId, question.targetId),
        ),
        eq(assistanceEvents.kind, 'full_translation'),
      );
  const [event] = await tx
    .select({ id: assistanceEvents.id })
    .from(assistanceEvents)
    .where(
      and(
        eq(assistanceEvents.userId, userId),
        eq(assistanceEvents.practiceSessionId, practiceId),
        lte(assistanceEvents.shownAt, submittedAt),
        matchingScope,
      ),
    )
    .limit(1);
  return Boolean(event);
}

async function updateLearningProgress(
  tx: AppTransaction,
  userId: string,
  vocabularyItemId: string,
  answer: StoredAnswer,
  submittedAt: Date,
): Promise<void> {
  await tx
    .insert(learningProgress)
    .values({
      vocabularyItemId,
      practiceCount: 1,
      firstTryCorrectCount: answer.isCorrect ? 1 : 0,
      assistedCount: answer.wasAssisted ? 1 : 0,
      lastPracticedAt: submittedAt,
      updatedAt: submittedAt,
    })
    .onConflictDoUpdate({
      target: learningProgress.vocabularyItemId,
      set: {
        practiceCount: sql`${learningProgress.practiceCount} + 1`,
        firstTryCorrectCount: sql`${learningProgress.firstTryCorrectCount} + ${answer.isCorrect ? 1 : 0}`,
        assistedCount: sql`${learningProgress.assistedCount} + ${answer.wasAssisted ? 1 : 0}`,
        lastPracticedAt: submittedAt,
        updatedAt: submittedAt,
      },
    });

  const updated = await tx
    .update(vocabularyItems)
    .set({ status: 'reviewing', updatedAt: submittedAt })
    .where(
      and(
        eq(vocabularyItems.id, vocabularyItemId),
        eq(vocabularyItems.userId, userId),
      ),
    )
    .returning({ id: vocabularyItems.id });
  if (updated.length !== 1) {
    throw new AppError('INTERNAL_ERROR', '学习进度暂时无法保存', 500, true);
  }
}

async function updatePracticeProgress(
  tx: AppTransaction,
  userId: string,
  practiceId: string,
  practice: PracticeLock,
  submittedAt: Date,
): Promise<void> {
  const [counts] = await tx
    .select({
      total: sql<number>`count(${practiceQuestions.id})::int`,
      answered: sql<number>`count(${answerAttempts.id})::int`,
    })
    .from(practiceQuestions)
    .innerJoin(
      practiceTargets,
      eq(practiceTargets.id, practiceQuestions.practiceTargetId),
    )
    .leftJoin(
      answerAttempts,
      and(
        eq(answerAttempts.practiceQuestionId, practiceQuestions.id),
        eq(answerAttempts.userId, userId),
      ),
    )
    .where(eq(practiceTargets.practiceSessionId, practiceId));
  if (!counts || counts.total === 0 || counts.answered > counts.total) {
    throw new AppError('INTERNAL_ERROR', '练习进度暂时无法保存', 500, true);
  }

  const completed = counts.answered === counts.total;
  if (completed) {
    assertPracticeTransition(practice.status, 'completed');
  } else if (practice.status === 'ready') {
    assertPracticeTransition('ready', 'in_progress');
  }

  await tx
    .update(practiceSessions)
    .set({
      status: completed ? 'completed' : 'in_progress',
      startedAt: practice.startedAt ?? submittedAt,
      ...(completed ? { completedAt: submittedAt } : {}),
    })
    .where(
      and(
        eq(practiceSessions.id, practiceId),
        eq(practiceSessions.userId, userId),
      ),
    );
}

async function loadAnswerResult(
  tx: AppTransaction,
  userId: string,
  practiceId: string,
  answerId: string,
): Promise<AnswerResult> {
  const [row] = await tx
    .select({
      id: answerAttempts.id,
      answerKind: answerAttempts.answerKind,
      selectedOptionId: answerAttempts.selectedOptionId,
      isCorrect: answerAttempts.isCorrect,
      wasAssisted: answerAttempts.wasAssisted,
      correctOptionId: practiceQuestions.correctOptionId,
      meaningEn: practiceQuestions.meaningEn,
      explanationZh: practiceQuestions.explanationZh,
      optionExplanations: practiceQuestions.optionExplanationsJson,
    })
    .from(answerAttempts)
    .innerJoin(
      practiceQuestions,
      eq(practiceQuestions.id, answerAttempts.practiceQuestionId),
    )
    .innerJoin(
      practiceTargets,
      eq(practiceTargets.id, practiceQuestions.practiceTargetId),
    )
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, answerAttempts.practiceSessionId),
    )
    .where(
      and(
        eq(answerAttempts.id, answerId),
        eq(answerAttempts.userId, userId),
        eq(answerAttempts.practiceSessionId, practiceId),
        eq(practiceTargets.practiceSessionId, practiceId),
        eq(practiceSessions.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', '答案不存在', 404);
  return toAnswerResult(row, row);
}

function toAnswerResult(
  answer: StoredAnswer,
  feedback: Pick<
    QuestionContext,
    'correctOptionId' | 'meaningEn' | 'explanationZh' | 'optionExplanations'
  >,
): AnswerResult {
  const common = {
    wasAssisted: answer.wasAssisted,
    correctOptionId: feedback.correctOptionId,
    meaningEn: feedback.meaningEn,
    explanationZh: feedback.explanationZh,
    optionExplanations: feedback.optionExplanations,
  };
  if (answer.answerKind === 'dont_know') {
    return AnswerResultSchema.parse({
      answerKind: 'dont_know',
      selectedOptionId: null,
      isCorrect: false,
      ...common,
    });
  }
  if (answer.selectedOptionId === null) {
    throw new AppError('INTERNAL_ERROR', '答案暂时无法读取', 500, true);
  }
  return AnswerResultSchema.parse({
    answerKind: 'option',
    selectedOptionId: answer.selectedOptionId,
    isCorrect: answer.isCorrect,
    ...common,
  });
}

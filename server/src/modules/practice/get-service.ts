import { and, asc, eq } from 'drizzle-orm';

import { PracticeGroupSchema, type PracticeDto } from '@context-reader/contracts';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import {
  answerAttempts,
  practiceParagraphs,
  practiceQuestions,
  practiceSessions,
  practiceTargets,
  vocabularyItems,
} from '../../db/schema';
import { getRemainingQuota } from '../quota/service';
import { serializePractice, type QuestionReadRow } from './serializer';

export async function getPracticeForUser(
  db: AppDatabase,
  input: { userId: string; practiceId: string; freeLimit: number },
): Promise<PracticeDto> {
  const [practice] = await db
    .select()
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.id, input.practiceId),
        eq(practiceSessions.userId, input.userId),
      ),
    )
    .limit(1);
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);

  const group = practice.topicGroupId ? PracticeGroupSchema.parse({
    id: practice.topicGroupId,
    articles: await db.select({
      id: practiceSessions.id,
      topic: practiceSessions.topic,
      status: practiceSessions.status,
      title: practiceSessions.articleTitle,
      wordCount: practiceSessions.articleWordCount,
      failureMessage: practiceSessions.failureMessagePublic,
    }).from(practiceSessions).where(and(
      eq(practiceSessions.topicGroupId, practice.topicGroupId),
      eq(practiceSessions.userId, input.userId),
    )).orderBy(asc(practiceSessions.topicPosition)),
  }) : undefined;
  const remainingFreePractices = await getRemainingQuota(
    db,
    input.userId,
    input.freeLimit,
  );
  if (
    practice.status === 'queued' ||
    practice.status === 'generating' ||
    practice.status === 'validating' ||
    practice.status === 'failed'
  ) {
    return { ...(group ? { group } : {}), ...serializePractice({
      practice,
      remainingFreePractices,
      paragraphs: [],
      targets: [],
      questions: [],
    }) };
  }

  const [paragraphs, targets, questionRows] = await Promise.all([
    db
      .select()
      .from(practiceParagraphs)
      .where(eq(practiceParagraphs.practiceSessionId, input.practiceId))
      .orderBy(asc(practiceParagraphs.position)),
    db
      .select()
      .from(practiceTargets)
      .where(eq(practiceTargets.practiceSessionId, input.practiceId))
      .orderBy(asc(practiceTargets.position)),
    db
      .select({
        id: practiceQuestions.id,
        targetId: practiceTargets.id,
        targetPosition: practiceTargets.position,
        term: vocabularyItems.term,
        prompt: practiceQuestions.prompt,
        options: practiceQuestions.optionsJson,
        correctOptionId: practiceQuestions.correctOptionId,
        meaningEn: practiceQuestions.meaningEn,
        explanationZh: practiceQuestions.explanationZh,
        optionExplanations: practiceQuestions.optionExplanationsJson,
        answerKind: answerAttempts.answerKind,
        selectedOptionId: answerAttempts.selectedOptionId,
        isCorrect: answerAttempts.isCorrect,
        wasAssisted: answerAttempts.wasAssisted,
      })
      .from(practiceQuestions)
      .innerJoin(
        practiceTargets,
        eq(practiceTargets.id, practiceQuestions.practiceTargetId),
      )
      .innerJoin(
        vocabularyItems,
        eq(vocabularyItems.id, practiceTargets.vocabularyItemId),
      )
      .leftJoin(
        answerAttempts,
        and(
          eq(answerAttempts.practiceQuestionId, practiceQuestions.id),
          eq(answerAttempts.userId, input.userId),
        ),
      )
      .where(eq(practiceTargets.practiceSessionId, input.practiceId))
      .orderBy(asc(practiceTargets.position)),
  ]);

  return { ...(group ? { group } : {}), ...serializePractice({
    practice,
    remainingFreePractices,
    paragraphs,
    targets,
    questions: questionRows satisfies QuestionReadRow[],
  }) };
}

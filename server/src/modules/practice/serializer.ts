import {
  PracticeDtoSchema,
  type AnswerResult,
  type PracticeDto,
} from '@context-reader/contracts';

import { AppError } from '../../core/errors';
import type {
  QuestionOption,
  practiceParagraphs,
  practiceSessions,
  practiceTargets,
} from '../../db/schema';
import { segmentParagraph } from './generation-validator';

type PracticeRow = typeof practiceSessions.$inferSelect;
type ParagraphRow = typeof practiceParagraphs.$inferSelect;
type TargetRow = typeof practiceTargets.$inferSelect;

export interface QuestionReadRow {
  id: string;
  targetId: string;
  targetPosition: number;
  term: string;
  prompt: string;
  options: QuestionOption[];
  correctOptionId: string;
  meaningEn: string;
  explanationZh: string;
  optionExplanations: Record<string, string>;
  answerKind: 'option' | 'dont_know' | null;
  selectedOptionId: string | null;
  isCorrect: boolean | null;
  wasAssisted: boolean | null;
}

export interface PracticeReadModel {
  practice: PracticeRow;
  remainingFreePractices: number;
  paragraphs: ParagraphRow[];
  targets: TargetRow[];
  questions: QuestionReadRow[];
}

export function serializePractice(model: PracticeReadModel): PracticeDto {
  const base = {
    id: model.practice.id,
    status: model.practice.status,
    modelName: model.practice.modelName,
    remainingFreePractices: model.remainingFreePractices,
  };

  if (isPending(model.practice.status)) {
    return PracticeDtoSchema.parse({
      ...base,
      pollAfterMs: 1_500,
      failure: null,
      article: null,
      questions: [],
    });
  }

  if (model.practice.status === 'failed') {
    return PracticeDtoSchema.parse({
      ...base,
      failure: {
        code: model.practice.failureCode ?? 'INTERNAL_ERROR',
        message:
          model.practice.failureMessagePublic ?? '练习暂时无法生成，请稍后重试',
        retryable: isRetryableFinalFailure(model.practice.failureCode),
      },
      article: null,
      questions: [],
    });
  }

  if (
    model.practice.articleTitle === null ||
    model.practice.articleWordCount === null ||
    model.paragraphs.length === 0
  ) {
    throw new AppError('INTERNAL_ERROR', '练习内容暂时无法读取', 500, true);
  }

  const targetsByParagraph = new Map<string, TargetRow[]>();
  for (const target of model.targets) {
    if (
      target.paragraphId === null ||
      target.startOffset === null ||
      target.endOffset === null
    ) {
      throw new AppError('INTERNAL_ERROR', '练习内容暂时无法读取', 500, true);
    }
    const paragraphTargets = targetsByParagraph.get(target.paragraphId) ?? [];
    paragraphTargets.push(target);
    targetsByParagraph.set(target.paragraphId, paragraphTargets);
  }

  return PracticeDtoSchema.parse({
    ...base,
    failure: null,
    article: {
      title: model.practice.articleTitle,
      wordCount: model.practice.articleWordCount,
      paragraphs: [...model.paragraphs]
        .sort((left, right) => left.position - right.position)
        .map((paragraph) => ({
          id: paragraph.id,
          position: paragraph.position,
          segments: segmentParagraph(
            paragraph.plainText,
            (targetsByParagraph.get(paragraph.id) ?? []).map((target) => ({
              id: target.id,
              startOffset: target.startOffset!,
              endOffset: target.endOffset!,
            })),
          ),
        })),
    },
    questions: [...model.questions]
      .sort((left, right) => left.targetPosition - right.targetPosition)
      .map((question) => ({
        id: question.id,
        targetId: question.targetId,
        term: question.term,
        prompt: question.prompt,
        options: question.options,
        submittedAnswer: serializeAnswer(question),
      })),
  });
}

function serializeAnswer(question: QuestionReadRow): AnswerResult | null {
  if (question.answerKind === null) return null;
  if (question.isCorrect === null || question.wasAssisted === null) {
    throw new AppError('INTERNAL_ERROR', '练习答案暂时无法读取', 500, true);
  }

  const feedback = {
    isCorrect: question.isCorrect,
    wasAssisted: question.wasAssisted,
    correctOptionId: question.correctOptionId,
    meaningEn: question.meaningEn,
    explanationZh: question.explanationZh,
    optionExplanations: question.optionExplanations,
  };
  if (question.answerKind === 'dont_know') {
    return {
      answerKind: 'dont_know',
      selectedOptionId: null,
      ...feedback,
      isCorrect: false,
    };
  }
  if (question.selectedOptionId === null) {
    throw new AppError('INTERNAL_ERROR', '练习答案暂时无法读取', 500, true);
  }
  return {
    answerKind: 'option',
    selectedOptionId: question.selectedOptionId,
    ...feedback,
  };
}

function isPending(status: PracticeRow['status']): boolean {
  return status === 'queued' || status === 'generating' || status === 'validating';
}

function isRetryableFinalFailure(code: string | null): boolean {
  return (
    code === 'AI_UNAVAILABLE' ||
    code === 'AI_INVALID_OUTPUT' ||
    code === 'GENERATION_DEADLINE_EXCEEDED' ||
    code === 'INTERNAL_ERROR'
  );
}

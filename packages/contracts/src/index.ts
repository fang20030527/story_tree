import { z } from 'zod';

export const UuidSchema = z.uuid();

export const AnonymousAuthRequestSchema = z
  .object({
    ageConfirmed14Plus: z.literal(true),
  })
  .strict();

export const AnonymousAuthResponseSchema = z
  .object({
    userId: UuidSchema,
    kind: z.literal('guest'),
    remainingFreePractices: z.number().int().nonnegative(),
  })
  .strict();

export const PracticeStatusSchema = z.enum([
  'queued',
  'generating',
  'validating',
  'ready',
  'in_progress',
  'completed',
  'failed',
]);

export const VocabularyStatusSchema = z.enum([
  'pending',
  'reviewing',
  'mastered',
  'self_reported',
]);

export const VocabularyInputSchema = z
  .object({
    term: z.string().trim().min(1).max(80),
    meaningZh: z.string().trim().min(1).max(200),
    sourceSentence: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const CreatePracticeRequestSchema = z
  .object({
    items: z.array(VocabularyInputSchema).min(1).max(10),
  })
  .strict();

export const CreatePracticeAcceptedSchema = z
  .object({
    practiceId: UuidSchema,
    status: PracticeStatusSchema,
    remainingFreePractices: z.number().int().nonnegative(),
    pollAfterMs: z.number().int().positive().optional(),
  })
  .strict();

export const PublicErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        requestId: UuidSchema,
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const PublicFailureSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export const ArticleSegmentSchema = z
  .object({
    text: z.string(),
    targetId: UuidSchema.nullable(),
  })
  .strict();

export const ArticleParagraphSchema = z
  .object({
    id: UuidSchema,
    position: z.number().int().nonnegative(),
    segments: z.array(ArticleSegmentSchema).min(1),
  })
  .strict();

const AnswerFeedbackFields = {
  wasAssisted: z.boolean(),
  correctOptionId: UuidSchema,
  meaningEn: z.string(),
  explanationZh: z.string(),
  optionExplanations: z.record(UuidSchema, z.string()),
};

export const AnswerResultSchema = z.discriminatedUnion('answerKind', [
  z
    .object({
      answerKind: z.literal('option'),
      selectedOptionId: UuidSchema,
      isCorrect: z.boolean(),
      ...AnswerFeedbackFields,
    })
    .strict(),
  z
    .object({
      answerKind: z.literal('dont_know'),
      selectedOptionId: z.null(),
      isCorrect: z.literal(false),
      ...AnswerFeedbackFields,
    })
    .strict(),
]);

export const PublicQuestionSchema = z
  .object({
    id: UuidSchema,
    targetId: UuidSchema,
    term: z.string(),
    prompt: z.string(),
    options: z
      .array(
        z
          .object({
            id: UuidSchema,
            label: z.string(),
          })
          .strict(),
      )
      .length(4),
    submittedAnswer: AnswerResultSchema.nullable(),
  })
  .strict();

export const PracticeDtoSchema = z
  .object({
    id: UuidSchema,
    status: PracticeStatusSchema,
    modelName: z.string().nullable(),
    remainingFreePractices: z.number().int().nonnegative(),
    pollAfterMs: z.number().int().positive().optional(),
    failure: PublicFailureSchema.nullable(),
    article: z
      .object({
        title: z.string(),
        wordCount: z.number().int().positive(),
        paragraphs: z.array(ArticleParagraphSchema).min(1),
      })
      .strict()
      .nullable(),
    questions: z.array(PublicQuestionSchema),
  })
  .strict();

export const TranslationDtoSchema = z
  .object({
    id: UuidSchema,
    status: z.enum(['queued', 'generating', 'ready', 'failed']),
    scope: z.enum(['paragraph', 'full']),
    paragraphId: UuidSchema.nullable(),
    translatedTextZh: z.string().nullable(),
    pollAfterMs: z.number().int().positive().optional(),
    failure: PublicFailureSchema.nullable(),
  })
  .strict();

export const VocabularyItemDtoSchema = z
  .object({
    id: UuidSchema,
    term: z.string(),
    meaningZh: z.string(),
    sourceSentence: z.string().nullable(),
    status: VocabularyStatusSchema,
    practiceCount: z.number().int().nonnegative(),
    firstTryCorrectCount: z.number().int().nonnegative(),
    assistedCount: z.number().int().nonnegative(),
    lastPracticedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const VocabularyPageSchema = z
  .object({
    items: z.array(VocabularyItemDtoSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type PracticeStatus = z.infer<typeof PracticeStatusSchema>;
export type AnonymousAuthRequest = z.infer<typeof AnonymousAuthRequestSchema>;
export type AnonymousAuthResponse = z.infer<typeof AnonymousAuthResponseSchema>;
export type VocabularyStatus = z.infer<typeof VocabularyStatusSchema>;
export type VocabularyInput = z.infer<typeof VocabularyInputSchema>;
export type CreatePracticeRequest = z.infer<typeof CreatePracticeRequestSchema>;
export type CreatePracticeAccepted = z.infer<typeof CreatePracticeAcceptedSchema>;
export type PublicError = z.infer<typeof PublicErrorSchema>;
export type PracticeDto = z.infer<typeof PracticeDtoSchema>;
export type TranslationDto = z.infer<typeof TranslationDtoSchema>;
export type AnswerResult = z.infer<typeof AnswerResultSchema>;
export type VocabularyPage = z.infer<typeof VocabularyPageSchema>;
export type VocabularyItemDto = z.infer<typeof VocabularyItemDtoSchema>;
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;
export type ArticleSegment = z.infer<typeof ArticleSegmentSchema>;
export type ArticleParagraph = z.infer<typeof ArticleParagraphSchema>;

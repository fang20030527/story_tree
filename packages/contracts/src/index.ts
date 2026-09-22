import { z } from 'zod';

export { abbreviatePartOfSpeech } from './part-of-speech';

export const UuidSchema = z.uuid();

export const EditorialImageParamsSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}\.webp$/u),
}).strict();

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

export const WechatAuthRequestSchema = z
  .object({
    code: z.string().trim().min(1).max(512),
  })
  .strict();

export const RegisteredAuthResponseSchema = z
  .object({
    userId: UuidSchema,
    kind: z.literal('registered'),
    remainingFreePractices: z.number().int().nonnegative(),
  })
  .strict();

export type WechatAuthRequest = z.infer<typeof WechatAuthRequestSchema>;
export const WechatAuthResponseSchema = RegisteredAuthResponseSchema;
export type RegisteredAuthResponse = z.infer<
  typeof RegisteredAuthResponseSchema
>;
export type WechatAuthResponse = RegisteredAuthResponse;

const EmailAddressSchema = z.string().trim().toLowerCase().email().max(320);

export const EmailAuthRequestSchema = z
  .object({
    email: EmailAddressSchema,
    password: z.string().min(8).max(128),
  })
  .strict();

export const EmailAuthResponseSchema = RegisteredAuthResponseSchema;

export type EmailAuthRequest = z.infer<typeof EmailAuthRequestSchema>;
export type EmailAuthResponse = z.infer<typeof EmailAuthResponseSchema>;

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
    sourceSentence: z.string().trim().min(1).max(10_000).optional(),
  })
  .strict();

export const CreatePracticeWithItemsRequestSchema = z
  .object({
    items: z.array(VocabularyInputSchema).min(1).max(10),
    format: z.literal('topic_set').optional(),
  })
  .strict();

export const CreatePracticeFromVocabularyRequestSchema = z
  .object({
    source: z.literal('vocabulary'),
    format: z.literal('topic_set').optional(),
    targetCount: z.number().int().positive().default(10),
  })
  .strict();

export const CreatePracticeRequestSchema = z.union([
  CreatePracticeWithItemsRequestSchema,
  CreatePracticeFromVocabularyRequestSchema,
]);

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

export const PracticeTopicSchema = z.enum([
  '经济', '文化', '政治', '科技', '教育', '环境', '社会',
]);
export type PracticeTopic = z.infer<typeof PracticeTopicSchema>;

export const PracticeGroupSchema = z.object({
  id: UuidSchema,
  articles: z.array(z.object({
    id: UuidSchema,
    topic: PracticeTopicSchema,
    status: PracticeStatusSchema,
    title: z.string().nullable(),
    wordCount: z.number().int().positive().nullable(),
    failureMessage: z.string().nullable(),
  }).strict()).length(4),
}).strict();

export const PracticeDtoSchema = z
  .object({
    group: PracticeGroupSchema.optional(),
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

export const TranslationRequestSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('paragraph'),
      paragraphId: UuidSchema,
    })
    .strict(),
  z.object({ scope: z.literal('full') }).strict(),
]);

export const AssistanceRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('word_hint'),
      targetId: UuidSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('paragraph_translation'),
      paragraphId: UuidSchema,
    })
    .strict(),
  z.object({ kind: z.literal('full_translation') }).strict(),
]);

export const AssistanceResponseSchema = z
  .object({
    recorded: z.literal(true),
    hintMeaningZh: z.string().nullable(),
    sourceSentence: z.string().nullable().optional(),
  })
  .strict();

/**
 * A lightweight lookup used by article readers.  Unlike practice
 * translations this request has no durable article/practice scope; the
 * caller supplies the selected word and its surrounding sentence so the
 * provider can choose the contextual meaning.
 */
export const WordTranslationRequestSchema = z
  .object({
    term: z.string().trim().min(1).max(80),
    context: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

/** The dictionary fields returned for one contextual word lookup. */
export const WordTranslationResultSchema = z
  .object({
    partOfSpeech: z.string().trim().min(1).max(40),
    meaningZh: z.string().trim().min(1).max(200),
    phoneticUk: z.string().trim().min(1).max(200).nullable().optional(),
    phoneticUs: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();

export const WordTranslationDtoSchema = z
  .object({
    term: z.string().trim().min(1).max(80),
    ...WordTranslationResultSchema.shape,
    savedSourceSentence: z.string().nullable().optional(),
  })
  .strict();

export const SubmitAnswerRequestSchema = z.discriminatedUnion('answerKind', [
  z
    .object({
      answerKind: z.literal('option'),
      questionId: UuidSchema,
      selectedOptionId: UuidSchema,
      elapsedMs: z.number().int().min(0).max(3_600_000),
    })
    .strict(),
  z
    .object({
      answerKind: z.literal('dont_know'),
      questionId: UuidSchema,
      elapsedMs: z.number().int().min(0).max(3_600_000),
    })
    .strict(),
]);

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

export const ArticleImportSourceKindSchema = z.enum([
  'url',
  'paste',
  'album',
  'local_file',
  'computer',
]);

export const ArticleImportStatusSchema = z.enum([
  'awaiting_upload',
  'queued',
  'processing',
  'retryable',
  'preview_ready',
  'confirmed',
  'failed',
  'expired',
  'cancelled',
]);

export const ImportAssetMediaTypeSchema = z.enum([
  'text/plain',
  'text/markdown',
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/octet-stream',
]);

export const ImportAssetDescriptorSchema = z
  .object({
    position: z.number().int().min(0).max(9),
    mediaType: ImportAssetMediaTypeSchema,
    byteSize: z.number().int().positive().max(10_485_760),
  })
  .strict();

const OrderedAlbumAssetsSchema = z
  .array(ImportAssetDescriptorSchema)
  .min(1)
  .max(10)
  .superRefine((assets, context) => {
    assets.forEach((entry, index) => {
      if (entry.position !== index) {
        context.addIssue({
          code: 'custom',
          path: [index, 'position'],
          message: '图片位置必须从 0 连续排列',
        });
      }
    });
    if (
      assets.reduce((sum, entry) => sum + entry.byteSize, 0) > 31_457_280
    ) {
      context.addIssue({
        code: 'custom',
        message: '文件总大小不能超过 30 MB',
      });
    }
  });

const LocalFileAssetsSchema = z
  .array(ImportAssetDescriptorSchema)
  .length(1)
  .superRefine((assets, context) => {
    if (assets[0]?.position !== 0) {
      context.addIssue({
        code: 'custom',
        path: [0, 'position'],
        message: '本地文件位置必须是 0',
      });
    }
  });

// Sharing apps often copy a title and description together with the URL.
export const SharedArticleUrlSchema = z.string().trim().max(8_192)
  .transform((value, context) => {
    const candidates = [...new Set(
      (value.replace(/\[[^\]\n]*\]\((https?:\/\/[^\s]+)\)/giu, '$1')
        .match(/https?:\/\/[^\s<>"“”「」【】]+/giu) ?? [])
        .map((candidate) => candidate.replace(/[，。！？；、）】》」”]+$/gu, '')),
    )];
    if (candidates.length !== 1) {
      context.addIssue({ code: 'custom', message: '请粘贴一条完整的 http 或 https 文章链接' });
      return z.NEVER;
    }
    return candidates[0]!;
  })
  .pipe(z.url().max(2_048).refine((value) => {
    const url = new URL(value);
    return /^https?:$/u.test(url.protocol) && !url.username && !url.password;
  }, '请使用无需账号密码的 http 或 https 链接'));

export const CreateArticleImportRequestSchema = z.discriminatedUnion(
  'sourceKind',
  [
    z
      .object({
        sourceKind: z.literal('url'),
        url: SharedArticleUrlSchema,
      })
      .strict(),
    z.object({ sourceKind: z.literal('paste') }).strict(),
    z
      .object({
        sourceKind: z.literal('album'),
        assets: OrderedAlbumAssetsSchema,
      })
      .strict(),
    z
      .object({
        sourceKind: z.literal('local_file'),
        assets: LocalFileAssetsSchema,
      })
      .strict(),
  ],
);

export const UpdateImportPreviewRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    text: z.string().min(1),
  })
  .strict();

export const ConfirmArticleImportRequestSchema = z
  .object({
    similarityDecision: z
      .enum(['open_existing', 'save_new_version'])
      .optional(),
  })
  .strict();

export const DuplicateArticleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('exact'),
      article: z
        .object({
          id: UuidSchema,
          title: z.string(),
          wordCount: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('similar'),
      article: z
        .object({
          id: UuidSchema,
          title: z.string(),
          wordCount: z.number().int().positive(),
          hammingDistance: z.number().int().min(0).max(3),
        })
        .strict(),
    })
    .strict(),
]);

export const ArticleImportDtoSchema = z
  .object({
    id: UuidSchema,
    sourceKind: ArticleImportSourceKindSchema,
    status: ArticleImportStatusSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    pollAfterMs: z.number().int().positive().optional(),
    failure: PublicFailureSchema.nullable(),
    preview: z
      .object({
        title: z.string().min(1).max(160),
        text: z.string().min(1),
        wordCount: z.number().int().min(20).max(5_000),
        duplicate: DuplicateArticleSchema,
      })
      .strict()
      .nullable(),
    articleId: UuidSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const polling = new Set(['awaiting_upload', 'queued', 'processing']);
    if (polling.has(value.status) !== (value.pollAfterMs !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['pollAfterMs'],
        message: '轮询字段与状态不匹配',
      });
    }
    if ((value.status === 'preview_ready') !== (value.preview !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['preview'],
        message: '预览字段与状态不匹配',
      });
    }
    if ((value.status === 'confirmed') !== (value.articleId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['articleId'],
        message: '文章字段与状态不匹配',
      });
    }
    const failed = value.status === 'retryable' || value.status === 'failed';
    if (failed !== (value.failure !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: '失败字段与状态不匹配',
      });
    }
  });

export const ImportedArticleSummaryDtoSchema = z
  .object({
    id: UuidSchema,
    sourceKind: ArticleImportSourceKindSchema,
    sourceUrl: z.url().nullable(),
    title: z.string().min(1).max(160),
    wordCount: z.number().int().min(20).max(5_000),
    importedAt: z.iso.datetime(),
  })
  .strict();

export const ImportedArticlePageSchema = z
  .object({
    items: z.array(ImportedArticleSummaryDtoSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export const ImportedArticleDtoSchema = z
  .object({
    id: UuidSchema,
    sourceKind: ArticleImportSourceKindSchema,
    sourceUrl: z.url().nullable(),
    title: z.string().min(1).max(160),
    wordCount: z.number().int().min(20).max(5_000),
    importedAt: z.iso.datetime(),
    paragraphs: z
      .array(
        z
          .object({
            id: UuidSchema,
            position: z.number().int().nonnegative(),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const CreatedComputerUploadSessionSchema = z
  .object({
    sessionId: UuidSchema,
    importId: UuidSchema,
    uploadUrl: z.url(),
    uploadCode: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/u),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const ComputerUploadSessionDtoSchema = z
  .object({
    id: UuidSchema,
    importId: UuidSchema,
    status: z.enum(['awaiting_code', 'claimed', 'uploaded', 'expired']),
    expiresAt: z.iso.datetime(),
    articleImport: ArticleImportDtoSchema,
  })
  .strict();

export const ArticleTranslationDtoSchema = TranslationDtoSchema;

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

export const VocabularyTimeZoneSchema = z.string().trim().min(1).max(64).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, '时区格式无效');

export const VocabularyWordFilterSchema = z.enum([
  'all',
  'due',
  'scheduled',
  'today',
  'learning',
  'unlearned',
  'mastered',
]);
export const VocabularyWordSchema = z.object({
  wordId: UuidSchema,
  term: z.string(),
  meaningZh: z.string(),
  sourceSentence: z.string().nullable(),
  contextCount: z.number().int().positive(),
  reviewReason: z.enum(['new', 'relearn', 'due', 'scheduled']),
  nextReviewAt: z.iso.datetime(),
  practiceCount: z.number().int().nonnegative(),
  independentCorrectCount: z.number().int().nonnegative(),
  assistedCount: z.number().int().nonnegative(),
  lastPracticedAt: z.iso.datetime().nullable(),
  masteredAt: z.iso.datetime().nullable(),
}).strict();
export const VocabularyWordPageSchema = z.object({
  items: z.array(VocabularyWordSchema),
  nextCursor: z.string().nullable(),
  evaluatedAt: z.iso.datetime(),
  nextRefreshAt: z.iso.datetime().nullable(),
  summary: z.object({
    totalCount: z.number().int().nonnegative(),
    todayCount: z.number().int().nonnegative(),
    learningCount: z.number().int().nonnegative(),
    dueLearningCount: z.number().int().nonnegative(),
    unlearnedCount: z.number().int().nonnegative(),
    masteredCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export const VocabularyWordContextsSchema = z.object({
  wordId: UuidSchema,
  contexts: z.array(z.object({
    id: UuidSchema,
    meaningZh: z.string(),
    sourceSentence: z.string().nullable(),
  }).strict()),
}).strict();
export const VocabularyWordMasterySchema = z.object({
  wordId: UuidSchema,
  masteredAt: z.iso.datetime().nullable(),
}).strict();
export type VocabularyWordFilter = z.infer<typeof VocabularyWordFilterSchema>;
export type VocabularyWord = z.infer<typeof VocabularyWordSchema>;
export type VocabularyWordPage = z.infer<typeof VocabularyWordPageSchema>;
export type VocabularyWordContexts = z.infer<typeof VocabularyWordContextsSchema>;
export type VocabularyWordMastery = z.infer<typeof VocabularyWordMasterySchema>;

export const DashboardDtoSchema = z
  .object({
    incompletePracticeId: UuidSchema.nullable(),
    vocabularyCount: z.number().int().nonnegative(),
    /** @deprecated 使用 dueLearningCount；旧客户端仍读取该字段。 */
    reviewingCount: z.number().int().nonnegative(),
    dueLearningCount: z.number().int().nonnegative(),
    unlearnedCount: z.number().int().nonnegative(),
    todayAddedCount: z.number().int().nonnegative(),
    completedPracticeCount: z.number().int().nonnegative(),
    remainingFreePractices: z.number().int().nonnegative(),
  })
  .strict();

export type PracticeStatus = z.infer<typeof PracticeStatusSchema>;
export type AnonymousAuthRequest = z.infer<typeof AnonymousAuthRequestSchema>;
export type AnonymousAuthResponse = z.infer<typeof AnonymousAuthResponseSchema>;
export type VocabularyStatus = z.infer<typeof VocabularyStatusSchema>;
export type VocabularyInput = z.infer<typeof VocabularyInputSchema>;
export type CreatePracticeWithItemsRequest = z.infer<
  typeof CreatePracticeWithItemsRequestSchema
>;
export type CreatePracticeFromVocabularyRequest = z.infer<
  typeof CreatePracticeFromVocabularyRequestSchema
>;
export type CreatePracticeRequest = z.infer<typeof CreatePracticeRequestSchema>;
export type CreatePracticeAccepted = z.infer<typeof CreatePracticeAcceptedSchema>;
export type PublicError = z.infer<typeof PublicErrorSchema>;
export type PracticeDto = z.infer<typeof PracticeDtoSchema>;
export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
export type AssistanceRequest = z.infer<typeof AssistanceRequestSchema>;
export type AssistanceResponse = z.infer<typeof AssistanceResponseSchema>;
export type WordTranslationRequest = z.infer<
  typeof WordTranslationRequestSchema
>;
export type WordTranslationResult = z.infer<
  typeof WordTranslationResultSchema
>;
export type WordTranslationDto = z.infer<typeof WordTranslationDtoSchema>;
export type SubmitAnswerRequest = z.infer<typeof SubmitAnswerRequestSchema>;
export type TranslationDto = z.infer<typeof TranslationDtoSchema>;
export type ArticleImportSourceKind = z.infer<
  typeof ArticleImportSourceKindSchema
>;
export type ArticleImportStatus = z.infer<typeof ArticleImportStatusSchema>;
export type ImportAssetDescriptor = z.infer<
  typeof ImportAssetDescriptorSchema
>;
export type CreateArticleImportRequest = z.infer<
  typeof CreateArticleImportRequestSchema
>;
export type UpdateImportPreviewRequest = z.infer<
  typeof UpdateImportPreviewRequestSchema
>;
export type ConfirmArticleImportRequest = z.infer<
  typeof ConfirmArticleImportRequestSchema
>;
export type ArticleImportDto = z.infer<typeof ArticleImportDtoSchema>;
export type ImportedArticleSummaryDto = z.infer<
  typeof ImportedArticleSummaryDtoSchema
>;
export type ImportedArticlePage = z.infer<typeof ImportedArticlePageSchema>;
export type ImportedArticleDto = z.infer<typeof ImportedArticleDtoSchema>;
export type CreatedComputerUploadSession = z.infer<
  typeof CreatedComputerUploadSessionSchema
>;
export type ComputerUploadSessionDto = z.infer<
  typeof ComputerUploadSessionDtoSchema
>;
export type ArticleTranslationDto = z.infer<
  typeof ArticleTranslationDtoSchema
>;
export type AnswerResult = z.infer<typeof AnswerResultSchema>;
export type VocabularyPage = z.infer<typeof VocabularyPageSchema>;
export type VocabularyItemDto = z.infer<typeof VocabularyItemDtoSchema>;
export type DashboardDto = z.infer<typeof DashboardDtoSchema>;
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;
export type ArticleSegment = z.infer<typeof ArticleSegmentSchema>;
export type ArticleParagraph = z.infer<typeof ArticleParagraphSchema>;

export const SentenceTranslationRequestSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
}).strict();

export const SentenceTranslationDtoSchema = z.object({
  translatedTextZh: z.string().trim().min(1),
}).strict();

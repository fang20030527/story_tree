import { z } from 'zod';

export { abbreviatePartOfSpeech } from './part-of-speech';

export const UuidSchema = z.uuid();

export const MESSAGE_BOTTLE_CONTENT_LIMIT = 1_000;
export const MessageBottleUsernameSchema = z.string().trim()
  .transform(value => value.normalize('NFKC'))
  .pipe(z.string().min(2).max(24).regex(/^[\p{L}\p{N}_·.-]+$/u));
export const CreateMessageBottleSchema = z.object({
  username: MessageBottleUsernameSchema,
  content: z.string().trim().min(1).max(MESSAGE_BOTTLE_CONTENT_LIMIT),
}).strict();
export const MessageBottleCursorSchema = z.string().max(80).refine(value => {
  const parts = value.split('_');
  return parts.length === 2 && z.iso.datetime().safeParse(parts[0]).success && UuidSchema.safeParse(parts[1]).success;
});
export const MessageBottleListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: MessageBottleCursorSchema.optional(),
}).strict();
export const MessageBottleDtoSchema = z.object({
  id: UuidSchema,
  username: MessageBottleUsernameSchema,
  content: z.string().min(1).max(MESSAGE_BOTTLE_CONTENT_LIMIT),
  createdAt: z.iso.datetime(),
  isMine: z.boolean(),
}).strict();
export const MessageBottlePageSchema = z.object({
  items: z.array(MessageBottleDtoSchema).max(50),
  nextCursor: MessageBottleCursorSchema.nullable(),
}).strict();
export const MessageBottleProfileSchema = z.object({
  username: MessageBottleUsernameSchema.nullable(),
  canPost: z.boolean(),
}).strict();
export type CreateMessageBottle = z.infer<typeof CreateMessageBottleSchema>;
export type MessageBottleDto = z.infer<typeof MessageBottleDtoSchema>;
export type MessageBottlePage = z.infer<typeof MessageBottlePageSchema>;
export type MessageBottleListQuery = z.infer<typeof MessageBottleListQuerySchema>;
export type MessageBottleProfile = z.infer<typeof MessageBottleProfileSchema>;

export const EditorialImageParamsSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}\.webp$/u),
}).strict();

export const PublishedEditorialIdSchema = z.string()
  .min(8)
  .max(64)
  .regex(/^remote-[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const PublishedEditorialMediaSchema = z.string().max(2_048).refine((value) => {
  if (/^\/v1\/editorial\/assets\/[a-z0-9][a-z0-9._-]{0,127}\.(?:webp|png|jpe?g|mp3)$/u.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}, '媒体地址必须是 HTTPS URL 或本站外刊素材路径');

const PublishedEditorialBaseSchema = z.object({
  id: PublishedEditorialIdSchema,
  titleZh: z.string().trim().min(1).max(180),
  titleEn: z.string().trim().min(1).max(180),
  summaryZh: z.string().trim().min(1).max(1_000),
  keyPointsZh: z.array(z.string().trim().min(1).max(180)).max(6),
  source: z.string().trim().min(1).max(80),
  sourceUrl: z.url().startsWith('https://').optional(),
  issueDate: z.iso.date().optional(),
  category: z.string().trim().min(1).max(40),
  wordCount: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  level: z.string().trim().min(1).max(40),
  image: PublishedEditorialMediaSchema,
  section: z.enum(['today', 'featured']),
  publishedAt: z.iso.date(),
  hasAudio: z.boolean(),
  audioUrl: PublishedEditorialMediaSchema.optional(),
});

export const PublishedEditorialSummarySchema = PublishedEditorialBaseSchema.strict();

export const PublishedEditorialArticleSchema = PublishedEditorialBaseSchema.extend({
  paragraphs: z.array(z.string().trim().min(1).max(10_000)).min(1).max(200),
  sectionHeadings: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  bodyBlocks: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(10_000) }).strict(),
    z.object({
      type: z.literal('image'),
      image: PublishedEditorialMediaSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).strict(),
  ])).max(300).optional(),
  figures: z.array(z.object({
    afterParagraph: z.number().int().nonnegative(),
    image: PublishedEditorialMediaSchema,
    caption: z.string().max(500),
  }).strict()).max(100).optional(),
  audioCues: z.array(z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
  ])).max(20_000).optional(),
}).strict();

export const PublishedEditorialCatalogSchema = z.object({
  articles: z.array(PublishedEditorialSummarySchema).max(5_000),
  featuredArticleId: PublishedEditorialIdSchema.optional(),
}).strict();

export type PublishedEditorialSummary = z.infer<typeof PublishedEditorialSummarySchema>;
export type PublishedEditorialArticle = z.infer<typeof PublishedEditorialArticleSchema>;
export type PublishedEditorialCatalog = z.infer<typeof PublishedEditorialCatalogSchema>;

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

export const PasswordResetRequestSchema = z.object({
  email: EmailAddressSchema,
}).strict();

export const PasswordResetRequestResponseSchema = z.object({
  message: z.literal('如果该邮箱已注册，重置验证码将发送至邮箱'),
}).strict();

export const PasswordResetConfirmSchema = z.object({
  email: EmailAddressSchema,
  code: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{12}$/u),
  newPassword: z.string().min(8).max(128),
}).strict();

export const PasswordResetConfirmResponseSchema = z.object({
  message: z.literal('密码已重置，请重新登录'),
}).strict();

export type PasswordResetRequestResponse = z.infer<typeof PasswordResetRequestResponseSchema>;
export type PasswordResetConfirmResponse = z.infer<typeof PasswordResetConfirmResponseSchema>;

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
  canRetryFailed: z.boolean(),
  articles: z.array(z.object({
    id: UuidSchema,
    topic: PracticeTopicSchema,
    status: PracticeStatusSchema,
    generationProgress: z.number().int().min(0).max(100),
    title: z.string().nullable(),
    wordCount: z.number().int().positive().nullable(),
    failureMessage: z.string().nullable(),
  }).strict()).length(4),
}).strict();

export const RetryFailedTopicsRequestSchema = z.object({}).strict();
export const RetryFailedTopicsResponseSchema = z.object({ groupId: UuidSchema }).strict();
export type RetryFailedTopicsResponse = z.infer<typeof RetryFailedTopicsResponseSchema>;

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

export const ImportedMediaUrlSchema = z.url().max(2_048).refine((value) => {
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.$/u, '').toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password &&
    hostname.includes('.') && !hostname.startsWith('[') &&
    !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/u.test(hostname);
}, '媒体地址必须是公开 HTTPS URL');

export const ImportedArticleSummaryDtoSchema = z
  .object({
    id: UuidSchema,
    sourceKind: ArticleImportSourceKindSchema,
    sourceUrl: z.url().nullable(),
    title: z.string().min(1).max(160),
    wordCount: z.number().int().min(20).max(5_000),
    importedAt: z.iso.datetime(),
    // Requested by newer clients; optional so an older API remains readable.
    coverImageUrl: ImportedMediaUrlSchema.nullable().optional(),
  })
  .strict();

export const ImportedArticlePageSchema = z
  .object({
    items: z.array(ImportedArticleSummaryDtoSchema).max(100),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export const ImportedArticleMediaSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    afterParagraph: z.number().int().min(-1),
    url: ImportedMediaUrlSchema,
    caption: z.string().max(500).nullable(),
    alt: z.string().max(300).nullable(),
    credit: z.string().max(100).nullable().optional(),
    captionParagraphPositions: z.array(z.number().int().nonnegative()).max(3).optional(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    type: z.literal('video'),
    afterParagraph: z.number().int().min(-1),
    url: ImportedMediaUrlSchema,
    posterUrl: ImportedMediaUrlSchema.nullable(),
    caption: z.string().max(500).nullable(),
    captionParagraphPositions: z.array(z.number().int().nonnegative()).max(3).optional(),
    direct: z.boolean(),
  }).strict(),
]);
export type ImportedArticleMedia = z.infer<typeof ImportedArticleMediaSchema>;

export const ImportedArticleDtoSchema = z
  .object({
    id: UuidSchema,
    sourceKind: ArticleImportSourceKindSchema,
    sourceUrl: z.url().nullable(),
    title: z.string().min(1).max(160),
    wordCount: z.number().int().min(20).max(5_000),
    importedAt: z.iso.datetime(),
    media: z.array(ImportedArticleMediaSchema).max(100).optional(),
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

// 口语素材的音视频与字幕单独上传，个人资源始终按账号隔离。
export const SPEAKING_MAX_MEDIA_BYTES = 3 * 1024 * 1024 * 1024;
export const SPEAKING_MAX_SUBTITLE_BYTES = 512 * 1024;
// 网页媒体先下载到设备再沿用文件上传，限制浏览器与原生端的临时内存占用。
export const SPEAKING_MAX_REMOTE_MEDIA_BYTES = 100 * 1024 * 1024;
export const SpeakingRemoteMediaRequestSchema = z.object({
  url: z.url().max(2_048).refine(value => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }, '请填写公开的 HTTP(S) 音视频或网页链接'),
}).strict();
export type SpeakingRemoteMediaRequest = z.infer<typeof SpeakingRemoteMediaRequestSchema>;
export const SpeakingResourceIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u)
  .refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), '资源编号无效');
export const SpeakingMediaTypeSchema = z.enum([
  'video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac',
  'audio/ogg', 'audio/webm',
]);
export const SpeakingCueSchema = z.object({
  id: SpeakingResourceIdSchema,
  start: z.number().finite().nonnegative().max(86_400),
  end: z.number().finite().positive().max(86_400),
  en: z.string().trim().min(1).max(4_000),
  zh: z.string().max(4_000),
}).strict().refine(cue => cue.end > cue.start, '结束时间必须晚于开始时间');
export type SpeakingCue = z.infer<typeof SpeakingCueSchema>;
export const SpeakingCuesSchema = z.array(SpeakingCueSchema).min(1).max(10_000)
  .superRefine((cues, context) => {
    const ids = new Set<string>();
    for (const [index, cue] of cues.entries()) {
      if (ids.has(cue.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: '字幕编号重复' });
      ids.add(cue.id);
      // 影视字幕允许不同说话者的时间区间重叠，但必须按开始时间排序。
      if (index && cue.start < cues[index - 1]!.start) {
        context.addIssue({ code: 'custom', path: [index, 'start'], message: '字幕必须按开始时间排序' });
      }
    }
  });
export const CreateSpeakingAssetRequestSchema = z.object({
  contentType: SpeakingMediaTypeSchema,
  byteSize: z.number().int().positive().max(SPEAKING_MAX_MEDIA_BYTES),
  purpose: z.enum(['material', 'recording']).default('material'),
}).strict();
export const SpeakingAssetDtoSchema = z.object({
  id: UuidSchema, status: z.enum(['awaiting_upload', 'ready']),
  uploadPath: z.string().startsWith('/v1/speaking/assets/'),
  byteSize: z.number().int().positive(), contentType: SpeakingMediaTypeSchema,
  duration: z.number().finite().nonnegative(), expiresAt: z.iso.datetime(),
  directUpload: z.object({ url: z.url(), expiresAt: z.iso.datetime() }).strict().optional(),
}).strict();
export const CompleteSpeakingAssetRequestSchema = z.object({
  duration: z.number().finite().positive().max(86_400),
}).strict();
export const CreateSpeakingMaterialRequestSchema = z.discriminatedUnion('sourceKind', [
  z.object({
    sourceKind: z.literal('file'), assetId: UuidSchema,
    title: z.string().trim().min(1).max(180), cues: SpeakingCuesSchema,
  }).strict(),
  z.object({
    sourceKind: z.literal('youtube'), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    title: z.string().trim().min(1).max(180),
    duration: z.number().finite().positive().max(86_400), cues: SpeakingCuesSchema,
  }).strict(),
]);
export const SpeakingMaterialDtoSchema = z.object({
  id: SpeakingResourceIdSchema, title: z.string().min(1).max(180),
  subtitle: z.string().max(500), category: z.string().max(80),
  sourceKind: z.enum(['platform', 'file', 'youtube']), mediaType: z.enum(['audio', 'video']),
  assetId: UuidSchema.nullable(), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u).nullable(),
  duration: z.number().finite().nonnegative(), cues: SpeakingCuesSchema,
  revision: z.number().int().positive(), createdAt: z.iso.datetime(),
}).strict();
export const SpeakingMaterialListSchema = z.object({
  materials: z.array(SpeakingMaterialDtoSchema.omit({ cues: true }).extend({ cueCount: z.number().int().nonnegative().max(10_000) }).strict()).max(150),
  nextCursor: UuidSchema.nullable(),
}).strict();
export const SpeakingMaterialSummarySchema = SpeakingMaterialDtoSchema.omit({ cues: true }).extend({
  cueCount: z.number().int().nonnegative().max(10_000),
}).strict();
export type SpeakingMaterialSummary = z.infer<typeof SpeakingMaterialSummarySchema>;
export const SpeakingCatalogDtoSchema = z.object({
  materials: z.array(SpeakingMaterialSummarySchema.extend({
    sourceKind: z.literal('platform'), assetId: z.null(), videoId: z.null(),
  }).strict()).max(100),
}).strict();
export type SpeakingCatalogDto = z.infer<typeof SpeakingCatalogDtoSchema>;
export const SpeakingLibraryQuerySchema = z.object({
  cursor: UuidSchema.optional(), limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const UpdateSpeakingSubtitlesRequestSchema = z.object({
  revision: z.number().int().positive(), cues: SpeakingCuesSchema,
}).strict();
export const ImportSpeakingSubtitlesRequestSchema = z.object({
  revision: z.number().int().positive(), format: z.enum(['srt', 'vtt']),
  text: z.string().min(1).max(SPEAKING_MAX_SUBTITLE_BYTES),
}).strict();
export const SpeakingRecordingSchema = z.object({
  assetId: UuidSchema, durationMs: z.number().int().positive().max(600_000),
  cueId: SpeakingResourceIdSchema,
  referenceText: z.string().trim().min(1).max(4_000).optional(),
  subtitleRevision: z.number().int().positive().optional(),
}).strict();
export const SpeakingStateDtoSchema = z.object({
  materialId: SpeakingResourceIdSchema, revision: z.number().int().nonnegative(),
  savedCueIds: z.array(SpeakingResourceIdSchema).max(10_000),
  notes: z.record(SpeakingResourceIdSchema, z.string().max(4_000)),
  position: z.number().finite().nonnegative().max(86_400),
  recording: SpeakingRecordingSchema.nullable(),
}).strict();
export const UpdateSpeakingStateRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  savedCueIds: z.array(SpeakingResourceIdSchema).max(10_000).optional(),
  notes: z.record(SpeakingResourceIdSchema, z.string().max(4_000)).optional(),
  position: z.number().finite().nonnegative().max(86_400).optional(),
  recording: SpeakingRecordingSchema.nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 1, '需要至少一个修改字段');
export const SpeakingSessionDtoSchema = z.object({
  id: SpeakingResourceIdSchema, materialId: SpeakingResourceIdSchema,
  title: z.string().min(1).max(180), date: z.iso.datetime(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  cueCount: z.number().int().nonnegative().max(10_000),
}).strict();
export const SaveSpeakingSessionRequestSchema = z.object({
  materialId: SpeakingResourceIdSchema, date: z.iso.datetime(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  cueCount: z.number().int().nonnegative().max(10_000),
  position: z.number().finite().nonnegative().max(86_400),
}).strict();
export const SpeakingLibraryDtoSchema = z.object({
  materials: z.array(SpeakingMaterialSummarySchema).max(150),
  states: z.array(SpeakingStateDtoSchema).max(150),
  sessions: z.array(SpeakingSessionDtoSchema).max(1_000),
  nextCursor: UuidSchema.nullable(),
}).strict();
export const SpeakingPlaybackDtoSchema = z.object({
  url: z.url(), expiresAt: z.iso.datetime(),
}).strict();
export const SPEAKING_PRONUNCIATION_MAX_DURATION_MS = 30_000;
export const SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES = 2 * 1024 ** 2;
export const SpeakingPronunciationLocaleSchema = z.enum(['en-us', 'en-gb']);
export const SpeakingPronunciationReferenceSchema = z.string().trim().min(1).max(1_000)
  .refine(text => /[a-z]/iu.test(text), '请提供英文字幕');
export const CreateSpeakingPronunciationRequestSchema = z.object({
  assetId: UuidSchema, materialId: SpeakingResourceIdSchema.nullable(), cueId: SpeakingResourceIdSchema,
  referenceText: SpeakingPronunciationReferenceSchema,
  subtitleRevision: z.number().int().positive().nullable(), locale: SpeakingPronunciationLocaleSchema,
}).strict().refine(value => value.materialId === null || value.subtitleRevision !== null, '云端素材需要字幕版本');
const PronunciationScoreSchema = z.number().finite().min(0).max(100);
const PronunciationTimeSchema = z.number().finite().nonnegative().max(SPEAKING_PRONUNCIATION_MAX_DURATION_MS).nullable();
export const SpeakingPronunciationPhonemeSchema = z.object({
  symbol: z.string().min(1).max(32), spokenSymbol: z.string().min(1).max(32).nullable(),
  score: PronunciationScoreSchema.nullable(), stressScore: PronunciationScoreSchema.nullable(),
  startMs: PronunciationTimeSchema, endMs: PronunciationTimeSchema,
}).strict().refine(value => value.startMs === null || value.endMs === null || value.endMs >= value.startMs, '音素时间无效');
export const SpeakingPronunciationWordSchema = z.object({
  word: z.string().min(1).max(200), score: PronunciationScoreSchema.nullable(),
  startMs: PronunciationTimeSchema, endMs: PronunciationTimeSchema,
  phonemes: z.array(SpeakingPronunciationPhonemeSchema).max(100),
}).strict().refine(value => value.startMs === null || value.endMs === null || value.endMs >= value.startMs, '单词时间无效');
export const SpeakingAcousticPronunciationResultSchema = z.object({
  score: PronunciationScoreSchema, words: z.array(SpeakingPronunciationWordSchema).min(1).max(250),
  feedback: z.array(z.string().min(1).max(500)).max(3),
}).strict();
export const SpeakingAiCoachingResultSchema = z.object({
  kind: z.literal('ai_coaching'), score: PronunciationScoreSchema,
  // 通用音频模型只提供练习参考，不伪造逐词、音素测量值。
  words: z.array(z.never()).max(0),
  transcript: z.string().trim().min(1).max(2_000),
  clarityScore: PronunciationScoreSchema.nullable(),
  fluencyScore: PronunciationScoreSchema.nullable(),
  completenessScore: PronunciationScoreSchema.nullable(),
  wordTips: z.array(z.object({
    word: z.string().trim().min(1).max(100),
    advice: z.string().trim().min(1).max(300),
  }).strict()).max(3),
  feedback: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
}).strict();
export const SpeakingPronunciationResultSchema = z.union([
  SpeakingAcousticPronunciationResultSchema, SpeakingAiCoachingResultSchema,
]);
export const SpeakingPronunciationProviderSchema = z.enum(['speechace', 'evolink']);
export const SpeakingPronunciationErrorSchema = z.object({
  code: z.string().min(1).max(80), message: z.string().min(1).max(500), retryable: z.boolean(),
}).strict();
export const SpeakingPronunciationAssessmentDtoSchema = z.object({
  id: UuidSchema, assetId: UuidSchema, materialId: SpeakingResourceIdSchema.nullable(), cueId: SpeakingResourceIdSchema,
  referenceText: SpeakingPronunciationReferenceSchema, subtitleRevision: z.number().int().positive().nullable(),
  locale: SpeakingPronunciationLocaleSchema, provider: SpeakingPronunciationProviderSchema,
  status: z.enum(['processing', 'ready', 'failed']), result: SpeakingPronunciationResultSchema.nullable(),
  error: SpeakingPronunciationErrorSchema.nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict().refine(value => value.status === 'ready' ? value.result !== null && value.error === null :
  value.status === 'failed' ? value.result === null && value.error !== null : value.result === null && value.error === null,
  '评测状态与结果不一致').refine(value => value.result === null ||
    (value.provider === 'evolink' ? 'kind' in value.result : !('kind' in value.result)),
  '评测来源与结果不一致');
export const SpeakingPronunciationCapabilitySchema = z.object({
  available: z.boolean(), provider: SpeakingPronunciationProviderSchema, maxDurationMs: z.number().int().positive(),
  maxAudioBytes: z.number().int().positive(), locales: z.array(SpeakingPronunciationLocaleSchema).min(1).max(2),
}).strict();
export const SpeakingCapabilitiesDtoSchema = z.object({
  storage: z.enum(['local', 'r2']), maxMediaBytes: z.number().int().positive(),
  maxSubtitleBytes: z.number().int().positive(), autoSubtitles: z.literal(false),
  pronunciation: SpeakingPronunciationCapabilitySchema.optional(),
}).strict();
export type SpeakingPronunciationLocale = z.infer<typeof SpeakingPronunciationLocaleSchema>;
export type CreateSpeakingPronunciationRequest = z.infer<typeof CreateSpeakingPronunciationRequestSchema>;
export type SpeakingPronunciationResult = z.infer<typeof SpeakingPronunciationResultSchema>;
export type SpeakingAiCoachingResult = z.infer<typeof SpeakingAiCoachingResultSchema>;
export type SpeakingPronunciationProvider = z.infer<typeof SpeakingPronunciationProviderSchema>;
export type SpeakingPronunciationAssessmentDto = z.infer<typeof SpeakingPronunciationAssessmentDtoSchema>;
export type SpeakingPronunciationError = z.infer<typeof SpeakingPronunciationErrorSchema>;
export type SpeakingPronunciationCapability = z.infer<typeof SpeakingPronunciationCapabilitySchema>;
export type CreateSpeakingAssetRequest = z.infer<typeof CreateSpeakingAssetRequestSchema>;
export type SpeakingAssetDto = z.infer<typeof SpeakingAssetDtoSchema>;
export type CompleteSpeakingAssetRequest = z.infer<typeof CompleteSpeakingAssetRequestSchema>;
export type CreateSpeakingMaterialRequest = z.infer<typeof CreateSpeakingMaterialRequestSchema>;
export type SpeakingMaterialDto = z.infer<typeof SpeakingMaterialDtoSchema>;
export type SpeakingStateDto = z.infer<typeof SpeakingStateDtoSchema>;
export type UpdateSpeakingStateRequest = z.infer<typeof UpdateSpeakingStateRequestSchema>;
export type SaveSpeakingSessionRequest = z.infer<typeof SaveSpeakingSessionRequestSchema>;
export type SpeakingSessionDto = z.infer<typeof SpeakingSessionDtoSchema>;
export type SpeakingLibraryDto = z.infer<typeof SpeakingLibraryDtoSchema>;

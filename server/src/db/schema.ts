import { sql } from 'drizzle-orm';
import type { WordReviewState, ConsolidatedReview } from '../modules/vocabulary/scheduler';
import {
  type AnyPgColumn,
  bigint as pgBigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const utcTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const userKind = pgEnum('user_kind', ['guest', 'registered']);
export const authIdentityProvider = pgEnum('auth_identity_provider', ['wechat']);
export const vocabularyStatus = pgEnum('vocabulary_status', [
  'pending',
  'reviewing',
  'mastered',
  'self_reported',
]);
export const examPath = pgEnum('exam_path', ['ielts']);
export const practiceStatus = pgEnum('practice_status', [
  'queued',
  'generating',
  'validating',
  'ready',
  'in_progress',
  'completed',
  'failed',
]);
export const translationScope = pgEnum('translation_scope', ['paragraph', 'full']);
export const translationStatus = pgEnum('translation_status', [
  'queued',
  'generating',
  'ready',
  'failed',
]);
export const articleImportSourceKind = pgEnum('article_import_source_kind', [
  'url',
  'paste',
  'album',
  'local_file',
  'computer',
]);
export const articleImportStatus = pgEnum('article_import_status', [
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
export const computerUploadStatus = pgEnum('computer_upload_status', [
  'awaiting_code',
  'claimed',
  'uploaded',
  'expired',
]);
export const jobKind = pgEnum('job_kind', [
  'practice_generation',
  'translation',
  'article_import',
  'article_translation',
]);
export const jobStatus = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);
export const assistanceKind = pgEnum('assistance_kind', [
  'word_hint',
  'paragraph_translation',
  'full_translation',
]);
export const answerKind = pgEnum('answer_kind', ['option', 'dont_know']);
export const ledgerKind = pgEnum('ledger_kind', ['reserve', 'commit', 'release']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: userKind('kind').default('guest').notNull(),
  ageConfirmedAt: utcTimestamp('age_confirmed_at').notNull(),
  createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  deletedAt: utcTimestamp('deleted_at'),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authIdentityProvider('provider').notNull(),
    subject: text('subject').notNull(),
    openid: text('openid').notNull(),
    unionid: text('unionid'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    lastLoginAt: utcTimestamp('last_login_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_subject_unique').on(
      table.provider,
      table.subject,
    ),
    index('auth_identities_user_idx').on(table.userId),
  ],
);

export const emailAccounts = pgTable(
  'email_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    lastLoginAt: utcTimestamp('last_login_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('email_accounts_email_unique').on(table.email),
    index('email_accounts_user_idx').on(table.userId),
  ],
);

export const installations = pgTable(
  'installations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    lastSeenAt: utcTimestamp('last_seen_at').defaultNow().notNull(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('installations_token_hash_unique').on(table.tokenHash),
    index('installations_user_idx').on(table.userId),
  ],
);

export const vocabularyWords = pgTable('vocabulary_words', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  normalizedTerm: text('normalized_term').notNull(),
  reviewState: jsonb('review_state').$type<WordReviewState>(),
  masteredAt: utcTimestamp('mastered_at'),
  createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('vocabulary_word_user_term_unique').on(table.userId, table.normalizedTerm),
]);

export const wordReviewEvents = pgTable('word_review_events', {
  wordId: uuid('word_id').notNull().references(() => vocabularyWords.id, { onDelete: 'cascade' }),
  practiceId: uuid('practice_id').notNull().references(() => practiceSessions.id, { onDelete: 'cascade' }),
  vocabularyItemId: uuid('vocabulary_item_id').notNull().references(() => vocabularyItems.id),
  outcome: text('outcome').$type<ConsolidatedReview['outcome']>().notNull(),
  wasAssisted: boolean('was_assisted').notNull(),
  reviewedAt: utcTimestamp('reviewed_at').notNull(),
}, (table) => [
  uniqueIndex('word_review_practice_unique').on(table.wordId, table.practiceId),
  check('word_review_outcome_check', sql`${table.outcome} in ('independent', 'failed', 'translated')`),
]);

export const vocabularyItems = pgTable(
  'vocabulary_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    wordId: uuid('word_id').references(() => vocabularyWords.id),
    normalizedTerm: text('normalized_term').notNull(),
    meaningZh: text('meaning_zh').notNull(),
    normalizedMeaningZh: text('normalized_meaning_zh').notNull(),
    sourceSentence: text('source_sentence'),
    fingerprint: text('fingerprint').notNull(),
    status: vocabularyStatus('status').default('pending').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
    deletedAt: utcTimestamp('deleted_at'),
  },
  (table) => [
    uniqueIndex('active_vocabulary_fingerprint_unique')
      .on(table.userId, table.fingerprint)
      .where(sql`${table.deletedAt} is null`),
    index('vocabulary_user_created_idx').on(table.userId, table.createdAt, table.id),
  ],
);

export const learningProgress = pgTable(
  'learning_progress',
  {
    vocabularyItemId: uuid('vocabulary_item_id')
      .primaryKey()
      .references(() => vocabularyItems.id, { onDelete: 'cascade' }),
    practiceCount: integer('practice_count').default(0).notNull(),
    firstTryCorrectCount: integer('first_try_correct_count').default(0).notNull(),
    assistedCount: integer('assisted_count').default(0).notNull(),
    lastPracticedAt: utcTimestamp('last_practiced_at'),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'learning_progress_nonnegative_check',
      sql`${table.practiceCount} >= 0 and ${table.firstTryCorrectCount} >= 0 and ${table.assistedCount} >= 0`,
    ),
  ],
);

export const practiceSessions = pgTable(
  'practice_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    examPath: examPath('exam_path').default('ielts').notNull(),
    status: practiceStatus('status').default('queued').notNull(),
    generationProgress: integer('generation_progress').default(0).notNull(),
    topicGroupId: uuid('topic_group_id'),
    topic: text('topic'),
    topicPosition: integer('topic_position'),
    articleTitle: text('article_title'),
    articleWordCount: integer('article_word_count'),
    modelName: text('model_name'),
    promptVersion: text('prompt_version'),
    failureCode: text('failure_code'),
    failureMessagePublic: text('failure_message_public'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    readyAt: utcTimestamp('ready_at'),
    startedAt: utcTimestamp('started_at'),
    completedAt: utcTimestamp('completed_at'),
  },
  (table) => [
    index('practice_user_created_idx').on(table.userId, table.createdAt, table.id),
    uniqueIndex('practice_group_position_idx').on(table.topicGroupId, table.topicPosition),
    uniqueIndex('practice_group_topic_idx').on(table.topicGroupId, table.topic),
  ],
);

export const practiceParagraphs = pgTable(
  'practice_paragraphs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceSessionId: uuid('practice_session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    plainText: text('plain_text').notNull(),
  },
  (table) => [
    unique('practice_paragraph_position_unique').on(
      table.practiceSessionId,
      table.position,
    ),
    check('practice_paragraph_position_check', sql`${table.position} >= 0`),
  ],
);

export const practiceTargets = pgTable(
  'practice_targets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceSessionId: uuid('practice_session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    vocabularyItemId: uuid('vocabulary_item_id')
      .notNull()
      .references(() => vocabularyItems.id),
    position: integer('position').notNull(),
    paragraphId: uuid('paragraph_id').references(() => practiceParagraphs.id),
    surfaceForm: text('surface_form'),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
  },
  (table) => [
    uniqueIndex('practice_target_item_unique').on(
      table.practiceSessionId,
      table.vocabularyItemId,
    ),
    unique('practice_target_position_unique').on(table.practiceSessionId, table.position),
    check('practice_target_position_check', sql`${table.position} >= 0`),
    check(
      'practice_target_generated_shape_check',
      sql`(
        ${table.paragraphId} is null and
        ${table.surfaceForm} is null and
        ${table.startOffset} is null and
        ${table.endOffset} is null
      ) or (
        ${table.paragraphId} is not null and
        ${table.surfaceForm} is not null and
        ${table.startOffset} >= 0 and
        ${table.endOffset} > ${table.startOffset}
      )`,
    ),
  ],
);

export interface QuestionOption {
  id: string;
  label: string;
}

export type OptionExplanations = Record<string, string>;

export const practiceQuestions = pgTable(
  'practice_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceTargetId: uuid('practice_target_id')
      .notNull()
      .references(() => practiceTargets.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    optionsJson: jsonb('options_json').$type<QuestionOption[]>().notNull(),
    correctOptionId: uuid('correct_option_id').notNull(),
    meaningEn: text('meaning_en').notNull(),
    explanationZh: text('explanation_zh').notNull(),
    optionExplanationsJson: jsonb('option_explanations_json')
      .$type<OptionExplanations>()
      .notNull(),
  },
  (table) => [unique('practice_question_target_unique').on(table.practiceTargetId)],
);

export const translations = pgTable(
  'translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceSessionId: uuid('practice_session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    scope: translationScope('scope').notNull(),
    paragraphId: uuid('paragraph_id').references(() => practiceParagraphs.id),
    sourceHash: text('source_hash').notNull(),
    status: translationStatus('status').default('queued').notNull(),
    translatedTextZh: text('translated_text_zh'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    readyAt: utcTimestamp('ready_at'),
  },
  (table) => [
    unique('translation_cache_unique')
      .on(table.practiceSessionId, table.scope, table.paragraphId, table.sourceHash)
      .nullsNotDistinct(),
    check(
      'translation_scope_shape_check',
      sql`(${table.scope} = 'full' and ${table.paragraphId} is null) or (${table.scope} = 'paragraph' and ${table.paragraphId} is not null)`,
    ),
  ],
);

export const importedArticles = pgTable(
  'imported_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceKind: articleImportSourceKind('source_kind').notNull(),
    sourceUrl: text('source_url'),
    title: text('title').notNull(),
    wordCount: integer('word_count').notNull(),
    contentHash: text('content_hash').notNull(),
    similarityFingerprint: pgBigint('similarity_fingerprint', {
      mode: 'bigint',
    }).notNull(),
    previousVersionId: uuid('previous_version_id').references(
      (): AnyPgColumn => importedArticles.id,
      { onDelete: 'set null' },
    ),
    importedAt: utcTimestamp('imported_at').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('imported_article_user_hash_unique').on(
      table.userId,
      table.contentHash,
    ),
    index('imported_article_user_created_idx').on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    check(
      'imported_article_word_count_check',
      sql`${table.wordCount} between 20 and 5000`,
    ),
    check(
      'imported_article_source_url_check',
      sql`(${table.sourceKind} = 'url' and ${table.sourceUrl} is not null) or (${table.sourceKind} <> 'url' and ${table.sourceUrl} is null)`,
    ),
  ],
);

export const articleParagraphs = pgTable(
  'article_paragraphs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => importedArticles.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    plainText: text('plain_text').notNull(),
  },
  (table) => [
    unique('article_paragraph_position_unique').on(
      table.articleId,
      table.position,
    ),
    check('article_paragraph_position_check', sql`${table.position} >= 0`),
    check(
      'article_paragraph_text_check',
      sql`length(${table.plainText}) > 0`,
    ),
  ],
);

export const articleTranslations = pgTable(
  'article_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => importedArticles.id, { onDelete: 'cascade' }),
    scope: translationScope('scope').notNull(),
    paragraphId: uuid('paragraph_id').references(() => articleParagraphs.id),
    sourceHash: text('source_hash').notNull(),
    status: translationStatus('status').default('queued').notNull(),
    translatedTextZh: text('translated_text_zh'),
    failureCode: text('failure_code'),
    failureMessagePublic: text('failure_message_public'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    readyAt: utcTimestamp('ready_at'),
  },
  (table) => [
    unique('article_translation_cache_unique')
      .on(table.articleId, table.scope, table.paragraphId, table.sourceHash)
      .nullsNotDistinct(),
    check(
      'article_translation_scope_shape_check',
      sql`(${table.scope} = 'full' and ${table.paragraphId} is null) or (${table.scope} = 'paragraph' and ${table.paragraphId} is not null)`,
    ),
    check(
      'article_translation_result_shape_check',
      sql`(
        ${table.status} in ('queued', 'generating') and
        ${table.translatedTextZh} is null and
        ${table.failureCode} is null and
        ${table.failureMessagePublic} is null and
        ${table.readyAt} is null
      ) or (
        ${table.status} = 'ready' and
        ${table.translatedTextZh} is not null and
        ${table.failureCode} is null and
        ${table.failureMessagePublic} is null and
        ${table.readyAt} is not null
      ) or (
        ${table.status} = 'failed' and
        ${table.translatedTextZh} is null and
        ${table.failureCode} is not null and
        ${table.failureMessagePublic} is not null and
        ${table.readyAt} is null
      )`,
    ),
  ],
);

export interface ImportAssetManifestEntry {
  position: number;
  mediaType: string;
  byteSize: number;
}

export const articleImports = pgTable(
  'article_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceKind: articleImportSourceKind('source_kind').notNull(),
    status: articleImportStatus('status').notNull(),
    sourceUrl: text('source_url'),
    assetManifestJson: jsonb('asset_manifest_json').$type<
      ImportAssetManifestEntry[]
    >(),
    previewTitle: text('preview_title'),
    previewText: text('preview_text'),
    wordCount: integer('word_count'),
    contentHash: text('content_hash'),
    similarityFingerprint: pgBigint('similarity_fingerprint', {
      mode: 'bigint',
    }),
    failureCode: text('failure_code'),
    failureMessagePublic: text('failure_message_public'),
    articleId: uuid('article_id').references(() => importedArticles.id, {
      onDelete: 'cascade',
    }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    updatedAt: utcTimestamp('updated_at').defaultNow().notNull(),
    processingStartedAt: utcTimestamp('processing_started_at'),
    previewReadyAt: utcTimestamp('preview_ready_at'),
    confirmedAt: utcTimestamp('confirmed_at'),
    expiresAt: utcTimestamp('expires_at').notNull(),
  },
  (table) => [
    index('article_import_user_created_idx').on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index('article_import_status_expiry_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('article_import_user_hash_idx').on(
      table.userId,
      table.contentHash,
    ),
    check(
      'article_import_attempt_count_check',
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      'article_import_preview_shape_check',
      sql`(
        ${table.status} in ('preview_ready', 'confirmed') and
        ${table.previewTitle} is not null and
        ${table.previewText} is not null and
        ${table.wordCount} between 20 and 5000 and
        ${table.contentHash} is not null and
        ${table.similarityFingerprint} is not null and
        ${table.previewReadyAt} is not null
      ) or (
        ${table.status} not in ('preview_ready', 'confirmed') and
        ${table.previewTitle} is null and
        ${table.previewText} is null and
        ${table.wordCount} is null and
        ${table.contentHash} is null and
        ${table.similarityFingerprint} is null and
        ${table.previewReadyAt} is null
      )`,
    ),
    check(
      'article_import_failure_shape_check',
      sql`(
        ${table.status} in ('retryable', 'failed') and
        ${table.failureCode} is not null and
        ${table.failureMessagePublic} is not null
      ) or (
        ${table.status} not in ('retryable', 'failed') and
        ${table.failureCode} is null and
        ${table.failureMessagePublic} is null
      )`,
    ),
    check(
      'article_import_article_shape_check',
      sql`(${table.status} = 'confirmed' and ${table.articleId} is not null and ${table.confirmedAt} is not null) or (${table.status} <> 'confirmed' and ${table.articleId} is null and ${table.confirmedAt} is null)`,
    ),
    check(
      'article_import_source_url_check',
      sql`(${table.sourceKind} = 'url' and ${table.sourceUrl} is not null) or (${table.sourceKind} <> 'url' and ${table.sourceUrl} is null)`,
    ),
    check(
      'article_import_manifest_check',
      sql`case
        when ${table.sourceKind} = 'album' then
          ${table.assetManifestJson} is not null and
          jsonb_typeof(${table.assetManifestJson}) = 'array' and
          jsonb_array_length(${table.assetManifestJson}) between 1 and 10
        when ${table.sourceKind} = 'local_file' then
          ${table.assetManifestJson} is not null and
          jsonb_typeof(${table.assetManifestJson}) = 'array' and
          jsonb_array_length(${table.assetManifestJson}) = 1
        else ${table.assetManifestJson} is null
      end`,
    ),
  ],
);

export const importAssets = pgTable(
  'import_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleImportId: uuid('article_import_id')
      .notNull()
      .references(() => articleImports.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    content: bytea('content').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('import_asset_position_unique').on(
      table.articleImportId,
      table.position,
    ),
    unique('import_asset_digest_unique').on(
      table.articleImportId,
      table.sha256,
    ),
    index('import_asset_created_idx').on(table.createdAt),
    check(
      'import_asset_position_check',
      sql`${table.position} between 0 and 9`,
    ),
    check(
      'import_asset_size_check',
      sql`${table.byteSize} between 1 and 10485760`,
    ),
    check('import_asset_digest_check', sql`length(${table.sha256}) = 64`),
  ],
);

export const computerUploadSessions = pgTable(
  'computer_upload_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    articleImportId: uuid('article_import_id')
      .notNull()
      .unique()
      .references(() => articleImports.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull().unique(),
    capabilityTokenHash: text('capability_token_hash').unique(),
    status: computerUploadStatus('status').default('awaiting_code').notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
    claimedAt: utcTimestamp('claimed_at'),
    uploadedAt: utcTimestamp('uploaded_at'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('computer_upload_expiry_idx').on(table.status, table.expiresAt),
    check(
      'computer_upload_state_shape_check',
      sql`(
        ${table.status} = 'awaiting_code' and
        ${table.capabilityTokenHash} is null and
        ${table.claimedAt} is null and
        ${table.uploadedAt} is null
      ) or (
        ${table.status} = 'claimed' and
        ${table.capabilityTokenHash} is not null and
        ${table.claimedAt} is not null and
        ${table.uploadedAt} is null
      ) or (
        ${table.status} = 'uploaded' and
        ${table.capabilityTokenHash} is null and
        ${table.claimedAt} is not null and
        ${table.uploadedAt} is not null
      ) or (
        ${table.status} = 'expired' and
        ${table.capabilityTokenHash} is null and
        ${table.uploadedAt} is null
      )`,
    ),
  ],
);

export const assistanceEvents = pgTable(
  'assistance_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceSessionId: uuid('practice_session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: assistanceKind('kind').notNull(),
    practiceTargetId: uuid('practice_target_id').references(() => practiceTargets.id),
    paragraphId: uuid('paragraph_id').references(() => practiceParagraphs.id),
    idempotencyKey: text('idempotency_key').notNull(),
    shownAt: utcTimestamp('shown_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assistance_idempotency_unique').on(
      table.userId,
      table.practiceSessionId,
      table.idempotencyKey,
    ),
    check(
      'assistance_kind_shape_check',
      sql`(
        ${table.kind} = 'word_hint' and
        ${table.practiceTargetId} is not null and
        ${table.paragraphId} is null
      ) or (
        ${table.kind} = 'paragraph_translation' and
        ${table.practiceTargetId} is null and
        ${table.paragraphId} is not null
      ) or (
        ${table.kind} = 'full_translation' and
        ${table.practiceTargetId} is null and
        ${table.paragraphId} is null
      )`,
    ),
  ],
);

export const answerAttempts = pgTable(
  'answer_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    practiceSessionId: uuid('practice_session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    practiceQuestionId: uuid('practice_question_id')
      .notNull()
      .references(() => practiceQuestions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answerKind: answerKind('answer_kind').notNull(),
    selectedOptionId: uuid('selected_option_id'),
    isCorrect: boolean('is_correct').notNull(),
    wasAssisted: boolean('was_assisted').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    submittedAt: utcTimestamp('submitted_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('answer_first_attempt_unique').on(table.userId, table.practiceQuestionId),
    uniqueIndex('answer_idempotency_unique').on(
      table.userId,
      table.practiceSessionId,
      table.idempotencyKey,
    ),
    check(
      'answer_kind_shape_check',
      sql`(${table.answerKind} = 'dont_know' and ${table.selectedOptionId} is null and ${table.isCorrect} = false) or (${table.answerKind} = 'option' and ${table.selectedOptionId} is not null)`,
    ),
    check('answer_elapsed_check', sql`${table.elapsedMs} >= 0`),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: jobKind('kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    status: jobStatus('status').default('queued').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    availableAt: utcTimestamp('available_at').defaultNow().notNull(),
    lockedAt: utcTimestamp('locked_at'),
    leaseExpiresAt: utcTimestamp('lease_expires_at'),
    lockedBy: text('locked_by'),
    deadlineAt: utcTimestamp('deadline_at').notNull(),
    lastErrorCode: text('last_error_code'),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    finishedAt: utcTimestamp('finished_at'),
  },
  (table) => [
    index('jobs_claimable_idx').on(table.status, table.availableAt, table.leaseExpiresAt),
    uniqueIndex('jobs_active_resource_unique')
      .on(table.kind, table.resourceId)
      .where(sql`${table.status} in ('queued', 'running')`),
    check(
      'jobs_attempts_check',
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
    expiresAt: utcTimestamp('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_operation_key_unique').on(
      table.userId,
      table.operation,
      table.idempotencyKey,
    ),
  ],
);

export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    practiceSessionId: uuid('practice_session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    kind: ledgerKind('kind').notNull(),
    amount: integer('amount').notNull(),
    operationKey: text('operation_key').notNull(),
    createdAt: utcTimestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('usage_operation_unique').on(table.operationKey),
    index('usage_user_idx').on(table.userId),
    check(
      'usage_kind_amount_check',
      sql`(${table.kind} = 'reserve' and ${table.amount} = -1) or (${table.kind} = 'commit' and ${table.amount} = 0) or (${table.kind} = 'release' and ${table.amount} = 1)`,
    ),
  ],
);

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

export const userKind = pgEnum('user_kind', ['guest', 'registered']);
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
export const jobKind = pgEnum('job_kind', ['practice_generation', 'translation']);
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

export const vocabularyItems = pgTable(
  'vocabulary_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
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
  (table) => [index('practice_user_created_idx').on(table.userId, table.createdAt, table.id)],
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

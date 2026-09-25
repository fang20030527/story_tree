-- D1 / SQLite schema corresponding to server/src/db/schema.ts after PostgreSQL migration 0009.
-- All timestamps are ISO 8601 UTC TEXT (for example 2026-09-25T12:34:56.789Z).
-- The application and data importer must normalize timestamps before binding them so
-- lexical comparisons preserve chronological order. Generated UUIDs are supplied by
-- the application with crypto.randomUUID(); existing UUIDs are imported unchanged.
-- PostgreSQL jsonb becomes valid JSON TEXT; booleans become INTEGER 0/1.
-- Signed 64-bit SimHash values are decimal TEXT to avoid JavaScript Number precision loss.

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest', 'registered')),
  age_confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('wechat')),
  subject TEXT NOT NULL,
  openid TEXT NOT NULL,
  unionid TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX auth_identities_provider_subject_unique ON auth_identities(provider, subject);
CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE email_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX email_accounts_email_unique ON email_accounts(email);
CREATE INDEX email_accounts_user_idx ON email_accounts(user_id);

CREATE TABLE email_password_resets (
  email_account_id TEXT PRIMARY KEY NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts_remaining INTEGER NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE TABLE installations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);
CREATE UNIQUE INDEX installations_token_hash_unique ON installations(token_hash);
CREATE INDEX installations_user_idx ON installations(user_id);

CREATE TABLE vocabulary_words (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_term TEXT NOT NULL,
  review_state TEXT CHECK (review_state IS NULL OR json_valid(review_state)),
  mastered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX vocabulary_word_user_term_unique ON vocabulary_words(user_id, normalized_term);

CREATE TABLE vocabulary_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  word_id TEXT REFERENCES vocabulary_words(id),
  normalized_term TEXT NOT NULL,
  meaning_zh TEXT NOT NULL,
  normalized_meaning_zh TEXT NOT NULL,
  source_sentence TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'mastered', 'self_reported')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX active_vocabulary_fingerprint_unique ON vocabulary_items(user_id, fingerprint) WHERE deleted_at IS NULL;
CREATE INDEX vocabulary_user_created_idx ON vocabulary_items(user_id, created_at, id);

CREATE TABLE learning_progress (
  vocabulary_item_id TEXT PRIMARY KEY NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  practice_count INTEGER NOT NULL DEFAULT 0,
  first_try_correct_count INTEGER NOT NULL DEFAULT 0,
  assisted_count INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT learning_progress_nonnegative_check CHECK (
    practice_count >= 0 AND first_try_correct_count >= 0 AND assisted_count >= 0
  )
);

CREATE TABLE practice_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_path TEXT NOT NULL DEFAULT 'ielts' CHECK (exam_path IN ('ielts')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'generating', 'validating', 'ready', 'in_progress', 'completed', 'failed'
  )),
  generation_progress INTEGER NOT NULL DEFAULT 0,
  topic_group_id TEXT,
  topic TEXT,
  topic_position INTEGER,
  article_title TEXT,
  article_word_count INTEGER,
  model_name TEXT,
  prompt_version TEXT,
  failure_code TEXT,
  failure_message_public TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ready_at TEXT,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX practice_user_created_idx ON practice_sessions(user_id, created_at, id);
CREATE UNIQUE INDEX practice_group_position_idx ON practice_sessions(topic_group_id, topic_position);
CREATE UNIQUE INDEX practice_group_topic_idx ON practice_sessions(topic_group_id, topic);

CREATE TABLE practice_paragraphs (
  id TEXT PRIMARY KEY NOT NULL,
  practice_session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  plain_text TEXT NOT NULL,
  CONSTRAINT practice_paragraph_position_unique UNIQUE (practice_session_id, position),
  CONSTRAINT practice_paragraph_position_check CHECK (position >= 0)
);

CREATE TABLE practice_targets (
  id TEXT PRIMARY KEY NOT NULL,
  practice_session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  vocabulary_item_id TEXT NOT NULL REFERENCES vocabulary_items(id),
  position INTEGER NOT NULL,
  paragraph_id TEXT REFERENCES practice_paragraphs(id),
  surface_form TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  CONSTRAINT practice_target_position_unique UNIQUE (practice_session_id, position),
  CONSTRAINT practice_target_position_check CHECK (position >= 0),
  CONSTRAINT practice_target_generated_shape_check CHECK (
    (paragraph_id IS NULL AND surface_form IS NULL AND start_offset IS NULL AND end_offset IS NULL)
    OR (paragraph_id IS NOT NULL AND surface_form IS NOT NULL AND start_offset >= 0 AND end_offset > start_offset)
  )
);
CREATE UNIQUE INDEX practice_target_item_unique ON practice_targets(practice_session_id, vocabulary_item_id);

CREATE TABLE practice_questions (
  id TEXT PRIMARY KEY NOT NULL,
  practice_target_id TEXT NOT NULL REFERENCES practice_targets(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  correct_option_id TEXT NOT NULL,
  meaning_en TEXT NOT NULL,
  explanation_zh TEXT NOT NULL,
  option_explanations_json TEXT NOT NULL CHECK (json_valid(option_explanations_json)),
  CONSTRAINT practice_question_target_unique UNIQUE (practice_target_id)
);

CREATE TABLE translations (
  id TEXT PRIMARY KEY NOT NULL,
  practice_session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('paragraph', 'full')),
  paragraph_id TEXT REFERENCES practice_paragraphs(id),
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  translated_text_zh TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ready_at TEXT,
  CONSTRAINT translation_scope_shape_check CHECK (
    (scope = 'full' AND paragraph_id IS NULL) OR (scope = 'paragraph' AND paragraph_id IS NOT NULL)
  )
);
-- SQLite UNIQUE treats NULL values as distinct; two partial indexes reproduce
-- PostgreSQL UNIQUE NULLS NOT DISTINCT for the full/paragraph cache key.
CREATE UNIQUE INDEX translation_cache_full_unique ON translations(practice_session_id, scope, source_hash) WHERE paragraph_id IS NULL;
CREATE UNIQUE INDEX translation_cache_paragraph_unique ON translations(practice_session_id, scope, paragraph_id, source_hash) WHERE paragraph_id IS NOT NULL;

CREATE TABLE word_review_events (
  word_id TEXT NOT NULL REFERENCES vocabulary_words(id) ON DELETE CASCADE,
  practice_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  vocabulary_item_id TEXT NOT NULL REFERENCES vocabulary_items(id),
  outcome TEXT NOT NULL,
  was_assisted INTEGER NOT NULL CHECK (was_assisted IN (0, 1)),
  reviewed_at TEXT NOT NULL,
  CONSTRAINT word_review_outcome_check CHECK (outcome IN ('independent', 'failed', 'translated'))
);
CREATE UNIQUE INDEX word_review_practice_unique ON word_review_events(word_id, practice_id);

CREATE TABLE imported_articles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('url', 'paste', 'album', 'local_file', 'computer')),
  source_url TEXT,
  title TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  similarity_fingerprint TEXT NOT NULL,
  previous_version_id TEXT REFERENCES imported_articles(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT imported_article_word_count_check CHECK (word_count BETWEEN 20 AND 5000),
  CONSTRAINT imported_article_source_url_check CHECK (
    (source_kind = 'url' AND source_url IS NOT NULL) OR (source_kind <> 'url' AND source_url IS NULL)
  )
);
CREATE UNIQUE INDEX imported_article_user_hash_unique ON imported_articles(user_id, content_hash);
CREATE INDEX imported_article_user_created_idx ON imported_articles(user_id, created_at, id);

CREATE TABLE article_paragraphs (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES imported_articles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  plain_text TEXT NOT NULL,
  CONSTRAINT article_paragraph_position_unique UNIQUE (article_id, position),
  CONSTRAINT article_paragraph_position_check CHECK (position >= 0),
  CONSTRAINT article_paragraph_text_check CHECK (length(plain_text) > 0)
);

CREATE TABLE article_translations (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES imported_articles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('paragraph', 'full')),
  paragraph_id TEXT REFERENCES article_paragraphs(id),
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  translated_text_zh TEXT,
  failure_code TEXT,
  failure_message_public TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ready_at TEXT,
  CONSTRAINT article_translation_scope_shape_check CHECK (
    (scope = 'full' AND paragraph_id IS NULL) OR (scope = 'paragraph' AND paragraph_id IS NOT NULL)
  ),
  CONSTRAINT article_translation_result_shape_check CHECK (
    (status IN ('queued', 'generating') AND translated_text_zh IS NULL AND failure_code IS NULL AND failure_message_public IS NULL AND ready_at IS NULL)
    OR (status = 'ready' AND translated_text_zh IS NOT NULL AND failure_code IS NULL AND failure_message_public IS NULL AND ready_at IS NOT NULL)
    OR (status = 'failed' AND translated_text_zh IS NULL AND failure_code IS NOT NULL AND failure_message_public IS NOT NULL AND ready_at IS NULL)
  )
);
CREATE UNIQUE INDEX article_translation_cache_full_unique ON article_translations(article_id, scope, source_hash) WHERE paragraph_id IS NULL;
CREATE UNIQUE INDEX article_translation_cache_paragraph_unique ON article_translations(article_id, scope, paragraph_id, source_hash) WHERE paragraph_id IS NOT NULL;

CREATE TABLE article_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('url', 'paste', 'album', 'local_file', 'computer')),
  status TEXT NOT NULL CHECK (status IN (
    'awaiting_upload', 'queued', 'processing', 'retryable', 'preview_ready',
    'confirmed', 'failed', 'expired', 'cancelled'
  )),
  source_url TEXT,
  asset_manifest_json TEXT CHECK (asset_manifest_json IS NULL OR json_valid(asset_manifest_json)),
  preview_title TEXT,
  preview_text TEXT,
  word_count INTEGER,
  content_hash TEXT,
  similarity_fingerprint TEXT,
  failure_code TEXT,
  failure_message_public TEXT,
  article_id TEXT REFERENCES imported_articles(id) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processing_started_at TEXT,
  preview_ready_at TEXT,
  confirmed_at TEXT,
  expires_at TEXT NOT NULL,
  CONSTRAINT article_import_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT article_import_preview_shape_check CHECK (
    (status IN ('preview_ready', 'confirmed') AND preview_title IS NOT NULL AND preview_text IS NOT NULL
      AND word_count BETWEEN 20 AND 5000 AND content_hash IS NOT NULL
      AND similarity_fingerprint IS NOT NULL AND preview_ready_at IS NOT NULL)
    OR (status NOT IN ('preview_ready', 'confirmed') AND preview_title IS NULL AND preview_text IS NULL
      AND word_count IS NULL AND content_hash IS NULL AND similarity_fingerprint IS NULL AND preview_ready_at IS NULL)
  ),
  CONSTRAINT article_import_failure_shape_check CHECK (
    (status IN ('retryable', 'failed') AND failure_code IS NOT NULL AND failure_message_public IS NOT NULL)
    OR (status NOT IN ('retryable', 'failed') AND failure_code IS NULL AND failure_message_public IS NULL)
  ),
  CONSTRAINT article_import_article_shape_check CHECK (
    (status = 'confirmed' AND article_id IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND article_id IS NULL AND confirmed_at IS NULL)
  ),
  CONSTRAINT article_import_source_url_check CHECK (
    (source_kind = 'url' AND source_url IS NOT NULL) OR (source_kind <> 'url' AND source_url IS NULL)
  ),
  CONSTRAINT article_import_manifest_check CHECK (
    CASE
      WHEN source_kind = 'album' THEN
        CASE WHEN json_valid(asset_manifest_json) THEN
          json_type(asset_manifest_json) = 'array' AND json_array_length(asset_manifest_json) BETWEEN 1 AND 10
        ELSE 0 END
      WHEN source_kind = 'local_file' THEN
        CASE WHEN json_valid(asset_manifest_json) THEN
          json_type(asset_manifest_json) = 'array' AND json_array_length(asset_manifest_json) = 1
        ELSE 0 END
      ELSE asset_manifest_json IS NULL
    END
  )
);
CREATE INDEX article_import_user_created_idx ON article_imports(user_id, created_at, id);
CREATE INDEX article_import_status_expiry_idx ON article_imports(status, expires_at);
CREATE INDEX article_import_user_hash_idx ON article_imports(user_id, content_hash);

CREATE TABLE import_assets (
  id TEXT PRIMARY KEY NOT NULL,
  article_import_id TEXT NOT NULL REFERENCES article_imports(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  -- Binary content is stored in the private R2 bucket; object_key is its key.
  object_key TEXT NOT NULL,
  -- Retained only for source-field compatibility; migrated rows keep this NULL.
  content BLOB,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT import_asset_position_unique UNIQUE (article_import_id, position),
  CONSTRAINT import_asset_digest_unique UNIQUE (article_import_id, sha256),
  CONSTRAINT import_asset_position_check CHECK (position BETWEEN 0 AND 9),
  CONSTRAINT import_asset_size_check CHECK (byte_size BETWEEN 1 AND 10485760),
  CONSTRAINT import_asset_digest_check CHECK (length(sha256) = 64)
);
CREATE UNIQUE INDEX import_asset_object_key_unique ON import_assets(object_key);
CREATE INDEX import_asset_created_idx ON import_assets(created_at);

CREATE TABLE computer_upload_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_import_id TEXT NOT NULL UNIQUE REFERENCES article_imports(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  capability_token_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'awaiting_code' CHECK (status IN ('awaiting_code', 'claimed', 'uploaded', 'expired')),
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  uploaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT computer_upload_state_shape_check CHECK (
    (status = 'awaiting_code' AND capability_token_hash IS NULL AND claimed_at IS NULL AND uploaded_at IS NULL)
    OR (status = 'claimed' AND capability_token_hash IS NOT NULL AND claimed_at IS NOT NULL AND uploaded_at IS NULL)
    OR (status = 'uploaded' AND capability_token_hash IS NULL AND claimed_at IS NOT NULL AND uploaded_at IS NOT NULL)
    OR (status = 'expired' AND capability_token_hash IS NULL AND uploaded_at IS NULL)
  )
);
CREATE INDEX computer_upload_expiry_idx ON computer_upload_sessions(status, expires_at);

CREATE TABLE assistance_events (
  id TEXT PRIMARY KEY NOT NULL,
  practice_session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('word_hint', 'paragraph_translation', 'full_translation')),
  practice_target_id TEXT REFERENCES practice_targets(id),
  paragraph_id TEXT REFERENCES practice_paragraphs(id),
  idempotency_key TEXT NOT NULL,
  shown_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT assistance_kind_shape_check CHECK (
    (kind = 'word_hint' AND practice_target_id IS NOT NULL AND paragraph_id IS NULL)
    OR (kind = 'paragraph_translation' AND practice_target_id IS NULL AND paragraph_id IS NOT NULL)
    OR (kind = 'full_translation' AND practice_target_id IS NULL AND paragraph_id IS NULL)
  )
);
CREATE UNIQUE INDEX assistance_idempotency_unique ON assistance_events(user_id, practice_session_id, idempotency_key);

CREATE TABLE answer_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  practice_session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  practice_question_id TEXT NOT NULL REFERENCES practice_questions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_kind TEXT NOT NULL CHECK (answer_kind IN ('option', 'dont_know')),
  selected_option_id TEXT,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  was_assisted INTEGER NOT NULL CHECK (was_assisted IN (0, 1)),
  elapsed_ms INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT answer_kind_shape_check CHECK (
    (answer_kind = 'dont_know' AND selected_option_id IS NULL AND is_correct = 0)
    OR (answer_kind = 'option' AND selected_option_id IS NOT NULL)
  ),
  CONSTRAINT answer_elapsed_check CHECK (elapsed_ms >= 0)
);
CREATE UNIQUE INDEX answer_first_attempt_unique ON answer_attempts(user_id, practice_question_id);
CREATE UNIQUE INDEX answer_idempotency_unique ON answer_attempts(user_id, practice_session_id, idempotency_key);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('practice_generation', 'translation', 'article_import', 'article_translation')),
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  locked_at TEXT,
  lease_expires_at TEXT,
  locked_by TEXT,
  deadline_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  CONSTRAINT jobs_attempts_check CHECK (attempt_count >= 0 AND max_attempts > 0)
);
CREATE INDEX jobs_claimable_idx ON jobs(status, available_at, lease_expires_at);
CREATE UNIQUE INDEX jobs_active_resource_unique ON jobs(kind, resource_id) WHERE status IN ('queued', 'running');

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idempotency_operation_key_unique ON idempotency_records(user_id, operation, idempotency_key);

CREATE TABLE usage_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reserve', 'commit', 'release')),
  amount INTEGER NOT NULL,
  operation_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT usage_kind_amount_check CHECK (
    (kind = 'reserve' AND amount = -1) OR (kind = 'commit' AND amount = 0) OR (kind = 'release' AND amount = 1)
  )
);
CREATE UNIQUE INDEX usage_operation_unique ON usage_ledger(operation_key);
CREATE INDEX usage_user_idx ON usage_ledger(user_id);

-- A shared limiter is required because Workers do not share process memory.
CREATE TABLE api_rate_limits (
  key_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  expires_at TEXT NOT NULL
);
CREATE INDEX api_rate_limits_expiry_idx ON api_rate_limits(expires_at);

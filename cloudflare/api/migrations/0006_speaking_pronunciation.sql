-- 评分快照独立于临时录音；清理旧资产时保留评分历史。
CREATE TABLE speaking_pronunciation_assessments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  material_id TEXT,
  cue_id TEXT NOT NULL,
  reference_text TEXT NOT NULL,
  subtitle_revision INTEGER CHECK (subtitle_revision IS NULL OR subtitle_revision >= 1),
  locale TEXT NOT NULL CHECK (locale IN ('en-us', 'en-gb')),
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  CHECK ((status = 'processing' AND result_json IS NULL AND error_json IS NULL)
    OR (status = 'ready' AND result_json IS NOT NULL AND error_json IS NULL)
    OR (status = 'failed' AND result_json IS NULL AND error_json IS NOT NULL)),
  CHECK (material_id IS NULL OR subtitle_revision IS NOT NULL)
);
CREATE UNIQUE INDEX speaking_pronunciation_active_fingerprint_idx
  ON speaking_pronunciation_assessments(user_id, fingerprint) WHERE status IN ('processing', 'ready');
CREATE INDEX speaking_pronunciation_daily_idx ON speaking_pronunciation_assessments(user_id, created_at);
CREATE INDEX speaking_pronunciation_deadline_idx ON speaking_pronunciation_assessments(user_id, status, deadline_at);

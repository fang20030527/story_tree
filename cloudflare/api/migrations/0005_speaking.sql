-- 只新增口语业务表，现有账号与阅读数据保持原有结构。
-- 时间字段统一为 ISO 8601 UTC TEXT，JSON 字段统一为合法 JSON TEXT。
CREATE TABLE speaking_assets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'awaiting_upload' CHECK (status IN ('awaiting_upload', 'ready')),
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 3221225472),
  purpose TEXT NOT NULL CHECK (purpose IN ('material', 'recording')),
  storage_key TEXT NOT NULL UNIQUE,
  duration REAL NOT NULL DEFAULT 0 CHECK (duration >= 0 AND duration <= 86400),
  media_type TEXT CHECK (media_type IN ('audio', 'video')),
  etag TEXT,
  expires_at TEXT NOT NULL,
  attached_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX speaking_assets_user_idx ON speaking_assets(user_id, attached_at, expires_at);

CREATE TABLE speaking_materials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('file', 'youtube')),
  title TEXT NOT NULL,
  asset_id TEXT UNIQUE REFERENCES speaking_assets(id),
  video_id TEXT,
  duration REAL NOT NULL CHECK (duration > 0 AND duration <= 86400),
  media_type TEXT NOT NULL CHECK (media_type IN ('audio', 'video')),
  cues_json TEXT NOT NULL CHECK (json_valid(cues_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((source_kind = 'file' AND asset_id IS NOT NULL AND video_id IS NULL)
    OR (source_kind = 'youtube' AND asset_id IS NULL AND video_id IS NOT NULL))
);
CREATE INDEX speaking_materials_user_created_idx ON speaking_materials(user_id, created_at, id);

CREATE TABLE speaking_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  subtitle_revision INTEGER NOT NULL DEFAULT 1 CHECK (subtitle_revision >= 1),
  custom_cues_json TEXT CHECK (custom_cues_json IS NULL OR json_valid(custom_cues_json)),
  saved_cue_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(saved_cue_ids_json)),
  notes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(notes_json)),
  position REAL NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 86400),
  position_session_date TEXT,
  recording_json TEXT CHECK (recording_json IS NULL OR json_valid(recording_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, material_id)
);

CREATE TABLE speaking_sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0 AND elapsed_ms <= 86400000),
  cue_count INTEGER NOT NULL CHECK (cue_count >= 0 AND cue_count <= 10000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX speaking_sessions_user_date_idx ON speaking_sessions(user_id, started_at);

CREATE TABLE speaking_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days')),
  UNIQUE (user_id, operation, idempotency_key)
);
CREATE INDEX speaking_idempotency_expiry_idx ON speaking_idempotency(expires_at);

-- 到期资产先在同一个 D1 事务里释放归属，再重试私有对象删除。
CREATE TABLE speaking_storage_cleanup (
  storage_key TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);

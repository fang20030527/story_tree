-- 账号级练习次数豁免；没有记录或开关为 0 时仍使用原免费额度。
CREATE TABLE user_practice_access (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unlimited_practices INTEGER NOT NULL DEFAULT 0 CHECK (unlimited_practices IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 每条留言一条开发者回复，删除原留言或任一所属账号时级联清理。
CREATE TABLE message_bottle_replies (
  bottle_id TEXT PRIMARY KEY NOT NULL REFERENCES message_bottles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX message_bottle_replies_user_idx ON message_bottle_replies(user_id);

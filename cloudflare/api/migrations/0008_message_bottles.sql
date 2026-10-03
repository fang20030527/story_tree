ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN username_key TEXT;
CREATE UNIQUE INDEX users_username_key_unique ON users(username_key);

CREATE TABLE message_bottles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX message_bottles_created_idx ON message_bottles(created_at, id);
CREATE INDEX message_bottles_user_created_idx ON message_bottles(user_id, created_at);

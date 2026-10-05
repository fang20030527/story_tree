-- 留言瓶的审核、举报、屏蔽和禁言。
-- status：visible 公开；pending 等待人工审核（先审后发模式下的新留言，或被 3 个人举报后自动隐藏）；
-- hidden 审核后隐藏。作者自己始终能看到自己的留言和它的状态。已有留言保持公开。
ALTER TABLE message_bottles ADD COLUMN status TEXT NOT NULL DEFAULT 'visible'
  CHECK (status IN ('visible', 'pending', 'hidden'));
ALTER TABLE message_bottles ADD COLUMN reviewed_at TEXT;
CREATE INDEX message_bottles_status_created_idx ON message_bottles(status, created_at, id);

-- 每人对每条留言只计一次举报；处理后填写 resolved_at。
CREATE TABLE message_bottle_reports (
  id TEXT PRIMARY KEY NOT NULL,
  bottle_id TEXT NOT NULL REFERENCES message_bottles(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'sexual', 'illegal', 'other')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 200),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX message_bottle_reports_unique ON message_bottle_reports(bottle_id, reporter_id);
CREATE INDEX message_bottle_reports_open_idx ON message_bottle_reports(resolved_at, created_at);

-- 屏蔽后看不到对方的留言；双方任一注销时记录随之删除。
CREATE TABLE user_blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks(blocked_id);

-- 审核后台对账号的处理：posting_banned_at 不为空时不能再发布留言。
CREATE TABLE user_moderation (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posting_banned_at TEXT,
  updated_at TEXT NOT NULL
);

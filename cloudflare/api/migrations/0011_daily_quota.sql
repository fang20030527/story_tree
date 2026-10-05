-- 免费练习改为按北京时间每天重置，同一台设备、同一个网络共用当天的额度。
-- 每次预留额度时记录设备编号和网络地址的 SHA-256 摘要，不关联账号：注销或新建账号后，
-- 同一设备当天已用的次数仍然有效。练习生成失败释放额度后，这条记录不再计数。
-- 只有当天的记录有用，定时任务删除两天前的记录。
CREATE TABLE quota_usage_events (
  practice_session_id TEXT PRIMARY KEY NOT NULL,
  device_hash TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX quota_usage_device_idx ON quota_usage_events(device_hash, created_at);
CREATE INDEX quota_usage_ip_idx ON quota_usage_events(ip_hash, created_at);
CREATE INDEX quota_usage_created_idx ON quota_usage_events(created_at);

-- 账号当天的预留次数按 (user_id, kind, created_at) 查找。
CREATE INDEX usage_user_kind_created_idx ON usage_ledger(user_id, kind, created_at);

-- 全站每天的 AI 调用次数（按北京时间日期计数），用来设置总量上限。
CREATE TABLE ai_usage_daily (
  day TEXT PRIMARY KEY NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0)
);

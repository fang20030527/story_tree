-- 为已注册账号回填用户名。users.username、users.username_key 和唯一索引 users_username_key_unique
-- 已由 0008 创建，本迁移只写数据，不改表结构，旧版 API 和客户端不受影响。
--
-- 回填规则：
-- 1. 取账号最早绑定的邮箱 @ 前的部分，转小写，+ 和 ' 换成 _，最多 24 个字符。
-- 2. 先注册的账号保留原名，同名的后来者改为 前缀（最多 15 个字符）+ _ + 账号 ID 前 8 位。
-- 3. 以下情况不使用邮箱前缀，改为 用户_ + 账号 ID 前 8 位：没有邮箱（例如只用微信登录）、
--    少于 2 个字符、含字母数字和 _ . - 以外的字符、没有字母或数字、命中保留字，
--    或含连续 6 位及以上数字（可能是手机号或 QQ 号，而用户名会在留言瓶里公开展示）。
-- 4. 已有用户名（留言瓶中自行设置的）、游客和已删除账号保持不变。
-- 5. 重复执行没有副作用：只处理 username 为空的注册账号。
--
-- 保留字列表必须与 packages/contracts 的 RESERVED_USERNAMES 中的英文项一致，
-- 由 cloudflare/api/src/auth/username-migration.test.ts 校验。

DROP TABLE IF EXISTS username_backfill;
CREATE TABLE username_backfill (
  seq INTEGER PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  hex TEXT NOT NULL,
  base TEXT NOT NULL,
  username TEXT
);

INSERT INTO username_backfill (seq, user_id, hex, base)
SELECT ROW_NUMBER() OVER (ORDER BY u.created_at, u.id),
       u.id,
       replace(u.id, '-', ''),
       COALESCE((
         SELECT substr(
                  replace(replace(lower(substr(e.email, 1, instr(e.email, '@') - 1)), '+', '_'), '''', '_'),
                  1, 24)
         FROM email_accounts AS e
         WHERE e.user_id = u.id AND instr(e.email, '@') > 1
         ORDER BY e.created_at, e.id
         LIMIT 1
       ), '')
FROM users AS u
WHERE u.kind = 'registered' AND u.deleted_at IS NULL AND u.username IS NULL
ORDER BY u.created_at, u.id;

-- 不适合公开展示的前缀置空，稍后统一使用兜底名。
UPDATE username_backfill SET base = ''
WHERE length(base) < 2
   OR base GLOB '*[^a-z0-9_.-]*'
   OR base NOT GLOB '*[a-z0-9]*'
   OR base GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9]*'
   OR replace(replace(replace(base, '_', ''), '.', ''), '-', '') IN (
     'admin', 'administrator', 'root', 'system', 'support', 'official', 'moderator', 'staff', 'service',
     'blackholeenglish'
   );

-- 第一层：同一前缀里最早注册的账号保留原名，前提是没有人已经占用这个名字。
UPDATE username_backfill SET username = base
WHERE base <> ''
  AND seq = (SELECT min(o.seq) FROM username_backfill AS o WHERE o.base = username_backfill.base)
  AND NOT EXISTS (SELECT 1 FROM users AS x WHERE x.username_key = username_backfill.base);

-- 第二层：其余账号使用账号 ID 片段区分，保证各不相同。
UPDATE username_backfill SET username = CASE
  WHEN base <> '' THEN substr(base, 1, 15) || '_' || substr(hex, 1, 8)
  ELSE '用户_' || substr(hex, 1, 8)
END
WHERE username IS NULL;

-- 写入前断言：回填结果之间、以及与已有用户名之间都没有重复。
-- 断言失败会触发 transaction_guards 的 CHECK，整个迁移中止，不会写入任何用户名。
DELETE FROM transaction_guards WHERE id = 'username-backfill';
INSERT INTO transaction_guards (id, valid)
SELECT 'username-backfill',
  CASE
    WHEN EXISTS (SELECT 1 FROM username_backfill GROUP BY lower(username) HAVING count(*) > 1)
      OR EXISTS (SELECT 1 FROM username_backfill AS b JOIN users AS x ON x.username_key = lower(b.username))
    THEN 0 ELSE 1
  END;
DELETE FROM transaction_guards WHERE id = 'username-backfill';

UPDATE users
SET username = (SELECT b.username FROM username_backfill AS b WHERE b.user_id = users.id),
    username_key = (SELECT lower(b.username) FROM username_backfill AS b WHERE b.user_id = users.id)
WHERE username IS NULL AND id IN (SELECT user_id FROM username_backfill);

DROP TABLE username_backfill;

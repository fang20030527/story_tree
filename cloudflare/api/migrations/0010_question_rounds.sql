-- 每个目标词在一次练习里可以有多道自测题：practice_questions 新增 round（0 是第一题，之后依次为 1、2），
-- 唯一约束由 (practice_target_id) 改为 (practice_target_id, round)。已有的题目都是第一题，round 取默认值 0。
--
-- SQLite 不能直接删除表级 UNIQUE 约束，只能重建 practice_questions。answer_attempts 以 ON DELETE CASCADE
-- 引用它，而 D1 始终强制外键、不能关闭，直接删除父表会把所有答案级联删光。所以按下面的顺序做，
-- 全程不依赖级联：
-- 1. 把两张表的数据复制到备份表；
-- 2. 先删子表 answer_attempts，再删父表 practice_questions（此时没有表再引用它）；
-- 3. 按新定义重建两张表（answer_attempts 与 0001 完全相同，practice_questions 只多了 round 和新的唯一约束）并还原数据；
-- 4. 核对行数，一致才删除备份表。核对失败会让 transaction_guards 的 CHECK 报错，迁移停在删除备份之前。
--
-- 旧版 API 写题目时不带 round，得到默认值 0，行为与以前相同；所以先执行本迁移、再发布 API，
-- 两个动作之间旧版 API 仍可正常使用。新版 API 在没有 round 列的库上不能运行，不要颠倒顺序。
--
-- 执行前建议记录 Time Travel 书签：npx wrangler d1 time-travel info waikan-core --config cloudflare/api/wrangler.jsonc

CREATE TABLE migration_0010_questions AS SELECT * FROM practice_questions;
CREATE TABLE migration_0010_answers AS SELECT * FROM answer_attempts;

DROP TABLE answer_attempts;
DROP TABLE practice_questions;

CREATE TABLE practice_questions (
  id TEXT PRIMARY KEY NOT NULL,
  practice_target_id TEXT NOT NULL REFERENCES practice_targets(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  correct_option_id TEXT NOT NULL,
  meaning_en TEXT NOT NULL,
  explanation_zh TEXT NOT NULL,
  option_explanations_json TEXT NOT NULL CHECK (json_valid(option_explanations_json)),
  round INTEGER NOT NULL DEFAULT 0 CHECK (round >= 0),
  CONSTRAINT practice_question_target_round_unique UNIQUE (practice_target_id, round)
);

INSERT INTO practice_questions
  (id, practice_target_id, prompt, options_json, correct_option_id,
   meaning_en, explanation_zh, option_explanations_json)
SELECT id, practice_target_id, prompt, options_json, correct_option_id,
       meaning_en, explanation_zh, option_explanations_json
FROM migration_0010_questions;

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

INSERT INTO answer_attempts
  (id, practice_session_id, practice_question_id, user_id, answer_kind, selected_option_id,
   is_correct, was_assisted, elapsed_ms, idempotency_key, submitted_at)
SELECT id, practice_session_id, practice_question_id, user_id, answer_kind, selected_option_id,
       is_correct, was_assisted, elapsed_ms, idempotency_key, submitted_at
FROM migration_0010_answers;

-- 行数不一致时 CHECK (valid = 1) 失败，迁移在这里中止，备份表仍然保留。
INSERT INTO transaction_guards (id, valid)
VALUES ('migration-0010', CASE WHEN
  (SELECT count(*) FROM practice_questions) = (SELECT count(*) FROM migration_0010_questions)
  AND (SELECT count(*) FROM answer_attempts) = (SELECT count(*) FROM migration_0010_answers)
THEN 1 ELSE 0 END);
DELETE FROM transaction_guards WHERE id = 'migration-0010';

DROP TABLE migration_0010_answers;
DROP TABLE migration_0010_questions;

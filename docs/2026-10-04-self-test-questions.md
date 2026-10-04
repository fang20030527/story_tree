# 自测题数

## 现象与原因

用户反馈：读完一篇 AI 短文后的自测只有两题。

原因不是故障，而是设计叠加的结果：

- 自测题与目标词一一对应，每个目标词一道英文语境填空。
- 四篇主题短文共用同一组选词。词库入口默认每组最多选 10 个待复习词，`planTopicTargets` 把它们分配到四篇，每篇通常只有 2–3 个目标词，所以每篇自测只有 2–3 题。
- [AI 生成中断修复](2026-09-27-ai-generation-runtime.md)里恢复的四篇短文，题目数分别是 3、3、2、2，与此一致。[四主题短文超时与进度修复](2026-09-23-topic-generation-timeout.md)为避免超时，把「每篇都用全部选词」改成「分配到四篇」，每篇题数少是这个修改的副作用。

调大「目标词数」只能间接增加题数，而且代价是每篇文章塞进更多生词、每组要复习的词更多，所以没有走这条路。

## 修改

文章里的目标词数量不变，改为让每个目标词在自测里多出几道题：每道都是新的句子、不同的情境和干扰项。

**题数规划**（`server/src/infrastructure/ai/article-metrics.ts` 的 `planQuestionCounts`）：每个目标词至少一题；总数不足 6 题时，从第一个词起依次再加一题，每词最多 3 题。

| 目标词数 | 每词题数 | 每篇自测题数 |
| ---: | --- | ---: |
| 1 | 3 | 3 |
| 2 | 3、3 | 6 |
| 3 | 2、2、2 | 6 |
| 4 | 2、2、1、1 | 6 |
| 5 | 2、1、1、1、1 | 6 |
| 6 及以上 | 每词 1 | 与词数相同 |

默认的每组 10 词意味着四篇各 2–3 个词，每篇自测从原来的 2–3 题变为 6 题。阈值是常量 `MIN_SELF_TEST_QUESTIONS`（最少题数）和 `MAX_QUESTIONS_PER_TARGET`（每词上限），只影响之后新生成的练习，已有练习保持原题。想要每篇更多题时两个常量要一起调：只调大最少题数，对只有 1–2 个词的文章没有效果，因为每词 3 题的上限先封顶。

**各环节**

| 环节 | 变化 |
| --- | --- |
| 提示词（`prompts.ts`） | 计划里有追加题时，写明每个别名的题数，要求同一个词的各题情境、句式、搭配和干扰项都不同，不得重复或相互泄露答案；后面的题解析从简。没有追加题时提示词与以前逐字相同 |
| 解析（`coerce.ts`） | 兼容模型把题目按别名分组成 `{ "t1": [题, 题] }` 的写法 |
| 校验（`generation-validator.ts`） | 每个目标词保留回复里写出的题，数量不超过计划；没有提示或与前一题重复的追加题被丢弃；追加题缺失时**不凭空补造**，只在 `notes` 里记 `QUESTIONS_SHORT:<别名>:<实得>/<计划>`。每个目标词至少有一题的保证不变（回复里没有时仍由文中句子挖空生成）。题目按轮次排序，同一个词不会连续出现 |
| 落库（`practice-generation.ts`） | 每题写入 `round`（0 是第一题）；提示词版本升到 `-v5` |
| 读取（`read.ts`） | 按「轮次、目标词顺序」返回题目 |
| 作答（`answer-write.ts`） | 见下文「复习排期不变」 |

客户端和契约都没有改：题目本来就是按列表渲染，进度、得分和「再练一次」都按 `questions` 的长度计算。**已安装的 App 不需要更新**。

## 复习排期不变

追加题是用户看过同一个词第一题的解析之后才作答的，不再是新鲜的回忆；如果让它们参与排期，多出的题会让「任一题答错就判整个词失败」更容易触发，复习变得更频繁。所以：

- 每个目标词在一次练习里**由第一题（`round = 0`）决定**那次复习的结果，`consolidateReviews` 忽略 `round > 0` 的答案，FSRS 的逻辑和以前完全相同。
- 追加题的答案照常保存，并计入词的 `answerCount`。`answerCount` 与答案表行数的一致性检查（创建练习、词库、仪表盘里都有）因此保持成立。
- `learning_progress`（词库里的练习次数、首答正确数）只在第一题累加，不会一次练习算成 2–3 次。
- 练习在所有题都答完后才变为 `completed`。

## 存储与迁移

`0010_question_rounds.sql` 为 `practice_questions` 增加 `round INTEGER NOT NULL DEFAULT 0`，并把唯一约束由 `(practice_target_id)` 改为 `(practice_target_id, round)`。已有题目都是第一题，取默认值 0。

SQLite 不能直接删除表级 `UNIQUE`，只能重建这张表；而 `answer_attempts` 以 `ON DELETE CASCADE` 引用它，D1 又始终强制外键、不能关闭，直接删表会把所有答案级联删光（`question-rounds-migration.test.ts` 里有一个用例演示了这一点）。D1 文档里的 `PRAGMA defer_foreign_keys` 只是把约束检查推迟到事务结束，没有说明它能阻止级联删除，所以不依赖它。迁移因此全程不依赖级联：

1. 把 `practice_questions` 和 `answer_attempts` 复制到备份表 `migration_0010_*`；
2. 先删子表 `answer_attempts`，再删父表 `practice_questions`；
3. 按新定义重建两张表（`answer_attempts` 与 `0001` 完全相同）并还原数据；
4. 用 `transaction_guards` 核对两张表的行数，一致才删除备份表。核对失败时 CHECK 报错，迁移停在删除备份之前，数据仍在备份表里。

D1 文档没有说明单个迁移文件是否整体回滚，所以迁移按「中途失败也不丢数据」来写，而不是依赖回滚。

**兼容**：旧版 API 写题目时不带 `round`，得到 0，行为与以前一样；新版 API 在没有 `round` 列的库上不能运行。所以必须先迁移、再发布 API，两步之间旧版 API 仍可使用。

**旧 Fastify 服务**（`server/`）没有同步：它的 Postgres 表仍是一词一题，处理器没有传 `questionCount`，校验器因此仍只保留每词一题，行为不变。它只用于本地开发，线上由 Cloudflare Worker 提供服务。

## 上线顺序与命令

迁移会短暂重建 `practice_questions` 和 `answer_attempts`。这两张表的数据量很小，预计是秒级，但没有在线上库测过。这段时间里的答题和读题请求可能返回 5xx，建议在低峰时段执行；已经提交成功的答案不受影响。

下面的命令**本次均未执行**：

```powershell
# 0. 回滚点与备份（只读），并记下两张表的行数
npx wrangler d1 time-travel info waikan-core --config cloudflare/api/wrangler.jsonc
npx wrangler d1 export waikan-core --remote --output backup-before-0010.sql --config cloudflare/api/wrangler.jsonc
npx wrangler d1 execute waikan-core --remote --config cloudflare/api/wrangler.jsonc --command "SELECT (SELECT count(*) FROM practice_questions) AS questions, (SELECT count(*) FROM answer_attempts) AS answers"

# 1. 执行增量迁移
npm run cloudflare:d1:migrate:api

# 2. 发布 API（客户端不需要重新发布）
npm run cloudflare:deploy:api
```

迁移后核对（只读）：

```sql
-- 行数应与迁移前相同
SELECT (SELECT count(*) FROM practice_questions) AS questions, (SELECT count(*) FROM answer_attempts) AS answers;
-- 应为 0：备份表已删除、没有遗留的守卫行
SELECT count(*) FROM sqlite_master WHERE name LIKE 'migration_0010_%';
SELECT count(*) FROM transaction_guards;
-- 迁移后现有题目的 round 都是 0
SELECT round, count(*) FROM practice_questions GROUP BY round;
-- 应没有结果
PRAGMA foreign_key_check;
```

发布后用新建的一组练习观察。在 `wrangler tail` 或 Workers Logs 里，`practice_generation` 事件的 `start.questions` 是计划题数，`persisted.questions` 是实际存入的题数，`validate.notes` 里出现 `QUESTIONS_SHORT` 说明模型没有按计划出够；`elapsedMs` 反映耗时变化。

用真实模型预先验证（会调用 EvoLink、产生费用，不写数据库）：

```powershell
$env:RUN_LIVE_SMOKE = '1'
npm run smoke:generation --workspace=@context-reader/server -- --words=2
```

`--words=2` 或 `3` 对应只有 2–3 个目标词的短文，报告会显示「实得题数/计划题数」和每篇耗时。不加 `RUN_LIVE_SMOKE`、加 `--fake` 则不联网。

回滚：迁移只增加列并重建表，旧版 API 可以继续使用；要撤销迁移本身，用 D1 Time Travel 恢复到上面记录的书签。

## 验证

- **服务端（不含数据库集成测试）**：51 个文件、503 项通过，其中新增 20 项（题数规划 3、提示词 4、解析 1、假 provider 1、校验器多题 9、复习调度 2）。类型检查和 lint 无错误。
- **Cloudflare Worker**：23 个文件、255 项通过，其中新增 14 项：迁移 7、答题 4、生成 3。测试要在仓库根目录运行，并放宽超时（Miniflare 用例在并发负载下会超过默认的 5 秒）。
- **迁移演练**：在开启外键的 `node:sqlite` 里种入「练习→目标→题→答案」数据后执行 `0010`，逐列核对题和答案原样保留、`foreign_key_check` 与 `integrity_check` 通过、唯一索引和级联仍然有效、备份表被清理；另有一个用例证明直接删父表确实会清空答案；还有一个用例让答案没有还原，确认行数核对会中止迁移并保留备份表。生成和答题测试又在 Miniflare（workerd）里逐条执行了 `0010`。没有在线上 D1 或 `wrangler --local` 上执行。
- **变异检查**：分别去掉「学习进度只在第一题累加」「调度忽略追加题」「按轮次排序」，对应的新用例都会失败，之后已恢复。
- **提示词**：没有追加题时（短文、长文、有无例句、9 个目标词四种输入），与改动前逐字相同。
- **端到端（假 provider，不联网）**：`smoke:generation -- --fake` 在 2、3、8 个目标词下分别得到 6/6、6/6、8/8 题。
- **其他**：契约 74 项通过；小程序、契约、服务端、Worker 的类型检查通过。`app` 的类型检查有 4 个与本次无关的错误（本机没有安装 `react-native-svg`，`/username` 的路由类型没有重新生成）；客户端没有改动，客户端测试没有运行。

**没有运行**：需要 PostgreSQL 的 23 个集成测试文件（本机没有本地测试库；这些测试走旧 Fastify 路径，那里的出题仍是一词一题，共享的校验器和调度器改动由上面的单元测试和类型检查覆盖），以及对真实模型的调用。

```powershell
# 服务端：不含需要数据库的集成测试
cd server
npx vitest run --exclude "**/*.integration.test.ts" --exclude "**/node_modules/**"

# Cloudflare Worker：在仓库根目录运行
npx vitest run cloudflare/api/src --testTimeout=120000 --hookTimeout=120000
```

## 已知限制

- **没有调用真实模型**。模型是否稳定按计划出够题、单篇耗时增加多少，需要上线后看日志或用上面的真实模型检查确认。题目部分的输出大约增加一倍（2–3 题变为 6 题），整篇输出的增幅小一些；仍在已支持的范围内：用户把目标词数调到 32 时，每篇本来就可能有 8 题。
- 模型没有出够追加题时，会少于 6 题而不是失败，也不会重写草稿，因此不会增加失败率；代价是这种情况下题数仍然偏少。
- 同一个词在一次自测里出现 2–3 次，后面的题可能受前面解析的提示而更容易。这是有意的取舍：追加题只用于强化，不影响排期。
- 只增加了英文语境填空题，没有增加阅读理解等其他题型。
- 目标词不足 6 个时，被多次提问的是排在前面的词，没有按难度挑选。

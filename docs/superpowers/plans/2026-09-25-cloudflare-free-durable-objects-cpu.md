# 免费套餐 Durable Objects 承载密码校验与答题重算

日期：2026-09-25。免费账户已部署 SQLite Durable Object，并用合成 scrypt 与 4,510 词英文长文执行核验；日志显示 Durable Object 使用约 239–253 ms CPU 且成功，入口 Worker 约 1 ms CPU。下文保留核验前的设计分析作为背景。

## CPU 限额结论

- [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)明确写免费套餐 HTTP Worker 每次请求为 **10 ms CPU**，内存为 128 MB。等待数据库或网络的时间不计入 CPU。
- [SQLite-backed Durable Objects 限额](https://developers.cloudflare.com/durable-objects/platform/limits/)在专门的表中写每次请求默认 **30 秒活跃 CPU**，可配置至 5 分钟；脚注写每个新请求重置 30 秒。相同页面明确免费套餐可使用 SQLite-backed Durable Objects。该 30 秒应理解为 DO 调用自身的预算，调用它的入口 Worker 仍受 10 ms 限制。
- **文档存在歧义**：DO 页面开头与 FAQ 又说它遵循 Workers 套餐的限额，与上述 30 秒表格未按套餐分列的写法不一致。仅凭文档不能证明免费账户实际执行 30 秒；启用业务路径前需在目标免费账户用小型 CPU canary 实测，并查看 `exceededCpu` / 1102 指标。免费套餐也不要假定可以使用 5 分钟配置；[Workers 文档](https://developers.cloudflare.com/workers/platform/limits/)把提高至 5 分钟写为付费功能。
- [DO 价格页](https://developers.cloudflare.com/durable-objects/platform/pricing/)写免费每日 100,000 次 DO 请求、13,000 GB-s 运行时长，SQLite 存储每天 500 万行读取、10 万行写入、账户总共 5 GB。每次 RPC 方法调用各算一次 DO 请求；入口 Worker 请求也单独计数。超过免费额度会失败，不能只按 CPU 判断可用性。

## 本地业务映射

| 路径 | 当前计算和持久化约束 | DO 方案 |
| --- | --- | --- |
| 邮箱注册、登录、重置密码 | `server/src/modules/auth/email-password.ts` 使用 `scrypt-v1`、16 字节盐、64 字节密钥，`N=16384,r=8,p=1,maxmem=32 MiB`，并用恒时比较；`cloudflare/api/src/auth/providers.ts` 和 `password-reset.ts` 调用它。 | 入口 Worker 做参数校验、限流与 D1 账户查询，按规范化邮箱散列得到 `PasswordCpuDO` ID，RPC 调用 `hashPassword` 或 `verifyPassword`。DO 复用原算法与编码格式，不落盘明文密码。Worker 在验证后保留现有 D1 条件更新和安装身份绑定。重置密码的哈希也必须走 DO。Cloudflare [node:crypto 文档](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)支持除列明例外外的 API；[更新日志](https://developers.cloudflare.com/workers/platform/changelog/)明确已加入 `scrypt`。 |
| 首次答题 | `server/src/modules/practice/answer-service.ts` 原来在同一 PostgreSQL 事务中处理幂等、用户隔离、首次答案、辅助证据、`learning_progress`、练习状态；`word-state.ts` 对同词所有历史答案执行 `replayReviews`，并同步复习事件。 | 入口 Worker 验证合同和安装身份后按 `userId` 调用 `UserAnswerDO.submitAnswer`。DO 从 D1 读取同词全部证据，调用同一 `ts-fsrs` 5.4.2 算法、0.90 保留率、无 fuzz 的 `consolidateReviews` / `replayReviews`，再用 D1 原子 batch 写入答案、释义进度、同词共享 `review_state`、复习事件、练习状态与幂等记录。 |

## 一致性设计

1. `UserAnswerDO` 按用户分片，方法内部显式排队同一用户的写入。DO 在等待 D1 时可能处理其他事件；不能仅凭“DO 单线程”假定跨 `await` 串行。[Cloudflare 的规则](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)也不建议用 `blockConcurrencyWhile()` 包裹外部 D1 I/O。
2. D1 是业务数据的唯一持久源。DO 本地 SQLite 事务无法跨越 D1 调用。[D1 `batch()` 文档](https://developers.cloudflare.com/d1/worker-api/d1-database/)保证同一 batch 语句按序执行，任一语句失败时整体回滚。因此读快照后必须用 D1 版本号和数据库约束做提交时校验；无匹配行的条件 `UPDATE` **不会自动使 batch 回滚**。可增加每用户版本列与带 `CHECK` 的提交保护表，在 batch 内先验证预期版本，版本冲突则使语句报错并回滚，随后重读重算。所有会改变词条、辅助、答案或复习状态的写入路径必须使用相同版本协议，或改走同一用户 DO。
3. 保留原规则：相同单词的不同释义共享状态；同一练习的多次答案按最差结果合并；答题前的 `word_hint` 视为失败；辅助记录按答题提交时间判定；答案一经提交不可改；历史作答按时间排序重放。新词创建时初始化复习状态并建立 `word_id`，对旧数据保留显式回填路径，不能假定所有后续词条都已有非空状态。
4. 原服务端重放范围随历史增长，不能设一个最终阻止用户学习的硬上限。DO 默认 30 秒即使在免费套餐得到实测确认，仍是有限预算。记录单次证据量、CPU 用量、冲突重试、D1 行读写和 `exceededCpu`；必要时再设计能证明与全量重放等价的检查点，或调整套餐。现有 Worker `/answers` 的 503 保护须保留到完整原子链路及 CPU canary 验证后。

## 启用门槛

1. 在目标免费账户部署隔离的 SQLite-backed DO canary，执行与现有参数相同的 scrypt 及逐渐增长的 FSRS 重放，确认单次 CPU 是否超过入口 Worker 的 10 ms 且没有 `exceededCpu`；记录 95/99 分位 CPU 和内存。
2. 实现两个 DO 的 RPC、D1 提交版本协议，以及入口 Worker 错误码映射；不向响应或日志输出密码、散列、正文和内部堆栈。
3. 核对首次答案、幂等重放、并发同词作答、辅助与作答竞态、密码旧哈希兼容以及失败回滚后，再开放相关路由。当前阶段不修改生产绑定或打开这些路由。

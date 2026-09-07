# 云端核心闭环后端设计

- 日期：2026-09-07
- 状态：交互设计已确认，等待书面规范复核
- 产品依据：`PRD.md`
- 实施范围：独立 Node.js 后端、Neon PostgreSQL、EvoLink AI，以及现有 Expo 客户端的最小端到端接入

## 1. 背景

仓库目前包含一个使用模拟数据的 Expo 客户端，以及可直接调用 EvoLink 文本生成和内容审核接口的 JavaScript 封装。环境文件已经提供 EvoLink 配置与 `DATABASE_URL`，但尚无数据库 Schema、HTTP API、后台任务处理、匿名身份或真实客户端数据流。

本轮建立第一个可运行的云端纵向切片：用户无需正式注册，在确认已满 14 周岁后，手动输入最多 10 个“词／短语＋具体中文义项”，生成一篇雅思难度的完整英文练习文章，按需查看翻译，完成单选测验，并在 Neon 中保存词库与学习进度。

## 2. 目标

1. 在 iOS、Android 或 Expo Web 上跑通“录入词义 → 生成文章 → 阅读／翻译 → 测验 → 进度更新”。
2. 确保 EvoLink 与 Neon 密钥只存在于后端。
3. AI 请求不占用长连接：生成和翻译进入可恢复、可重试的数据库任务队列。
4. 所有会产生费用或推进进度的写操作都具备幂等性。
5. 保存不可变的答题事实，使学习进度可以重新计算和审计。
6. 保留未来接入正式账号、复习调度、订阅和多设备同步的演进路径。

## 3. 非目标

本轮不实现：

- 手机号、微信或 Apple 登录；
- URL、文章正文、PDF 或图片导入；
- 自动选词、词典、音标或发音；
- 正式间隔复习算法和“已掌握”认证；
- 商店订阅、退款或恢复购买；
- 正式运营审核后台；
- 推送通知、社区、排行榜或公开文章库；
- 完整离线答题与多设备冲突合并；
- EvoLink 之外的备用 AI 供应商；
- Expo SDK 升级。

## 4. 技术决策

采用模块化单体，而不是同步脚本或多服务架构：

- Node.js 22.13 或更高版本；
- TypeScript；
- Fastify HTTP 服务；
- Zod 作为运行时输入、领域对象和 AI 输出校验器；
- Drizzle ORM 与 `pg` 连接 Neon；
- PostgreSQL 表充当持久化任务队列；
- Vitest 作为后端测试运行器；
- Expo 客户端继续使用当前 SDK 54，不在本轮升级；
- npm workspaces 管理 `app`、`server` 和共享契约包。

选择 `pg` 而不是 Neon HTTP 驱动，是因为任务领取需要交互式事务以及 `FOR UPDATE SKIP LOCKED`。API 与 Worker 在开发环境由同一命令启动，但它们通过模块边界解耦；未来可将 Worker 作为单独进程运行而无需改写业务逻辑。

## 5. 目录与模块边界

计划中的仓库结构：

```text
app/                         Expo 客户端
  src/api/                   HTTP 客户端、鉴权和错误映射
  src/features/practice/     录入、生成、阅读、测验、结果
  src/features/vocabulary/   云端词库与进度
server/                      独立 Node.js 服务
  src/app.ts                 构建 Fastify 实例，不监听端口
  src/index.ts               进程入口和优雅关闭
  src/config/                环境变量校验
  src/db/                    Drizzle Schema、连接和迁移入口
  src/modules/auth/          匿名身份与安装令牌
  src/modules/vocabulary/    词义标准化与词库查询
  src/modules/practice/      练习状态机、作答和进度
  src/modules/translation/   翻译任务与缓存
  src/modules/jobs/          领取、租约、重试和超时
  src/modules/quota/         免费额度预留、确认与返还
  src/infrastructure/ai/     EvoLink Provider、提示词和审核
packages/contracts/          App 与 Server 共用的 Zod DTO 和类型
```

每个模块只通过公开服务接口访问另一个模块，不直接导入对方的数据库查询实现。路由层只负责认证、校验和 HTTP 映射；业务规则位于服务层；Drizzle 查询位于仓储层。

## 6. 系统结构

```text
Expo App
   │ HTTPS JSON + Bearer installation token
   ▼
Fastify API ───────────────► Neon PostgreSQL
   │                             ▲
   │ enqueue job                 │ lease / persist result
   ▼                    ┌────────┘
   ▼                    │
Database-backed Worker ─┴──────► EvoLink generation + moderation
```

Fastify 返回真实状态而不是虚假进度百分比。创建任务后返回 `202 Accepted`；客户端根据 `pollAfterMs` 轮询，在 App 回到前台时继续查询。准备完成的文章存入数据库，客户端退出或更换页面不会触发重新生成。

## 7. 匿名身份

客户端首次运行时生成 256 位随机安装令牌，先保存到 Expo SecureStore，再以 `Authorization: Bearer <token>` 调用匿名注册接口。服务端只保存令牌的 SHA-256 哈希，不保存明文，也不采集 Android ID、IDFV 或其他硬件标识。

匿名注册请求必须包含 `ageConfirmed14Plus: true`。数据库只保存确认时间，不保存生日。相同安装令牌的重试返回同一身份，从而避免“服务端成功、客户端丢失响应”时生成两个用户。

安装令牌在本轮作为长期凭据使用，可被服务端撤销。卸载、清除 SecureStore 或丢失令牌后无法找回匿名数据；客户端会明确提示这一限制。正式登录上线时，安装记录可绑定或合并到注册账号。

## 8. 数据模型

所有主键使用 UUID，时间使用 UTC `timestamptz`。正文、问题和答案使用 UTF-8 文本。枚举在应用层和数据库约束中保持一致。

### 8.1 主体与安装

`users`

- `id`
- `kind`: 当前固定为 `guest`，预留 `registered`
- `age_confirmed_at`
- `created_at`
- `deleted_at`

`installations`

- `id`
- `user_id`
- `token_hash`，唯一
- `created_at`
- `last_seen_at`
- `revoked_at`

### 8.2 词义与学习进度

`vocabulary_items`

- `id`, `user_id`
- `term`, `normalized_term`
- `meaning_zh`, `normalized_meaning_zh`
- `source_sentence`，可空
- `fingerprint`
- `status`: `pending`、`reviewing`、`mastered`、`self_reported`
- `created_at`, `updated_at`, `deleted_at`

标准化只做 Unicode NFKC、首尾空白、连续空白折叠和英文词形小写。中文释义不会做语义推断式合并。相同用户、相同标准化词形和相同标准化释义会复用现有活动词条；不同释义必须创建不同词条。

`learning_progress`

- `vocabulary_item_id`，主键
- `practice_count`
- `first_try_correct_count`
- `assisted_count`
- `last_practiced_at`
- `updated_at`

本轮只维护基础计数和 `pending/reviewing` 状态，不计算正式“已掌握”。

### 8.3 练习、文章与题目

`practice_sessions`

- `id`, `user_id`
- `exam_path`: 当前固定为 `ielts`
- `status`: `queued`、`generating`、`validating`、`ready`、`in_progress`、`completed`、`failed`
- `article_title`
- `article_word_count`
- `model_name`, `prompt_version`
- `failure_code`, `failure_message_public`
- `created_at`, `ready_at`, `started_at`, `completed_at`

`practice_paragraphs`

- `id`, `practice_session_id`
- `position`
- `plain_text`
- 唯一约束：`practice_session_id + position`

`practice_targets`

- `id`, `practice_session_id`, `vocabulary_item_id`
- `position`：保留用户本次输入顺序
- `paragraph_id`，生成完成前可空
- `surface_form`，生成完成前可空
- `start_offset`, `end_offset`，生成完成前可空
- 唯一约束：一个练习中每个 `vocabulary_item_id` 只出现一次目标映射

`practice_questions`

- `id`, `practice_target_id`
- `prompt`
- `options_json`: 四个带稳定 ID 的选项
- `correct_option_id`
- `meaning_en`
- `explanation_zh`
- `option_explanations_json`

文章进入 `ready` 后，上述文章和题目记录不可原地修改。重生成通过新练习版本完成。

### 8.4 翻译、辅助与答案

`translations`

- `id`, `practice_session_id`
- `scope`: `paragraph` 或 `full`
- `paragraph_id`，全文翻译时为空
- `source_hash`
- `status`: `queued`、`generating`、`ready`、`failed`
- `translated_text_zh`
- `created_at`, `ready_at`
- 活动缓存唯一约束：练习、范围、段落和源文本哈希

`assistance_events`

- `id`, `practice_session_id`, `user_id`
- `kind`: `word_hint`、`paragraph_translation`、`full_translation`
- `practice_target_id` 或 `paragraph_id`，按类型可空
- `idempotency_key`
- `shown_at`

`answer_attempts`

- `id`, `practice_session_id`, `practice_question_id`, `user_id`
- `selected_option_id`
- `is_correct`
- `was_assisted`
- `elapsed_ms`
- `idempotency_key`
- `submitted_at`
- 唯一约束：`user_id + practice_question_id`

`was_assisted` 在事务中根据提交答案前已经发生的辅助事件计算。查看全文翻译影响本篇全部目标；段落翻译影响该段目标；词义提示只影响对应目标。提交后的辅助不会追溯改变已经保存的首次答案。

### 8.5 任务、幂等与额度

`jobs`

- `id`
- `kind`: `practice_generation`、`translation`
- `resource_id`
- `status`: `queued`、`running`、`succeeded`、`failed`
- `attempt_count`, `max_attempts`
- `available_at`, `locked_at`, `lease_expires_at`, `locked_by`
- `deadline_at`
- `last_error_code`
- `created_at`, `finished_at`

任务只保存资源引用，不复制文章或用户输入。Worker 使用短事务和 `FOR UPDATE SKIP LOCKED` 领取任务；过期租约可被其他 Worker 重新领取。

`idempotency_records`

- `user_id`, `operation`, `idempotency_key`
- `request_hash`
- `resource_type`, `resource_id`
- `created_at`, `expires_at`
- 唯一约束：`user_id + operation + idempotency_key`

同一个幂等键配合不同请求内容时返回 `IDEMPOTENCY_KEY_REUSED`，不会静默复用旧结果。

`usage_ledger`

- `id`, `user_id`, `practice_session_id`
- `kind`: `reserve`、`commit`、`release`
- `amount`
- `operation_key`
- `created_at`

匿名用户默认有三篇免费练习。`reserve` 写入 `amount = -1`，`commit` 写入 `amount = 0`，`release` 写入 `amount = +1`；剩余额度等于初始额度加账本金额之和。创建练习时在数据库事务中预留一篇额度；练习进入 `ready` 时确认消耗；最终失败时返还。账本操作键唯一，避免并发和重试造成重复扣减。

## 9. API 契约

所有业务接口位于 `/v1`，使用 JSON。错误统一为：

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "可向用户展示的简体中文信息",
    "requestId": "uuid",
    "retryable": false
  }
}
```

### 9.1 身份

`POST /v1/auth/anonymous`

- 鉴权：客户端生成的 Bearer 安装令牌
- 请求：`{ "ageConfirmed14Plus": true }`
- 响应：匿名用户摘要、三篇免费额度的剩余数量
- 重复调用：返回现有身份，不创建重复用户

### 9.2 创建与读取练习

`POST /v1/practices`

- 必须带 `Idempotency-Key`
- 请求包含 1–10 个 `{ term, meaningZh, sourceSentence? }`
- 服务端在一个事务中复用或创建词条、预留额度、创建练习与目标并加入生成任务
- 响应：`202`，包含 `practiceId`、`status`、`pollAfterMs` 和剩余额度

输入上限：词／短语 80 个字符，中文义项 200 个字符，原句 1,000 个字符。空值、同一批次的完全重复项和超限输入在进入 AI 前拒绝。

`GET /v1/practices/:id`

- 排队或生成时返回当前状态和建议轮询间隔
- 失败时返回公开错误码、是否可重试和未消耗额度的结果
- 准备完成后返回文章段落、安全文本片段、目标映射、题目与选项
- 在答题前绝不返回 `correctOptionId`、正确性或解释

后端根据目标位置把段落转换为：

```json
{
  "segments": [
    { "text": "Ordinary text", "targetId": null },
    { "text": "resilient", "targetId": "uuid" }
  ]
}
```

客户端不解析或渲染后端 HTML。

### 9.3 翻译与辅助

`POST /v1/practices/:id/translations`

- 必须带 `Idempotency-Key`
- 请求：全文范围，或指定属于该练习的 `paragraphId`
- 命中缓存时返回 `200`
- 未命中时创建任务并返回 `202` 和 `translationId`

`GET /v1/translations/:id`

- 返回翻译任务状态；`ready` 后返回译文

`POST /v1/practices/:id/assistance`

- 必须带 `Idempotency-Key`
- 只有客户端实际展示翻译或提示时调用
- 服务端校验目标或段落确实属于该练习

### 9.4 作答与进度

`POST /v1/practices/:id/answers`

- 必须带 `Idempotency-Key`
- 请求：`questionId`、`selectedOptionId`、`elapsedMs`
- 首次提交后返回正确性、正确选项、中文解释、英文释义和各干扰项说明
- 相同题目的后续提交返回第一次结果，不推进第二次进度
- 当所有题目都有首次答案后，服务端自动把练习置为 `completed`

`GET /v1/vocabulary-items`

- 使用游标分页
- 返回词义、状态、基础计数和最近练习时间

`GET /v1/dashboard`

- 返回当前未完成练习、词义统计、已完成篇数和剩余免费额度

### 9.5 健康检查

- `GET /health/live`：只证明进程可响应
- `GET /health/ready`：执行有超时的轻量数据库检查

健康检查不调用 EvoLink，避免探针产生费用或把供应商瞬时波动变成进程重启。

## 10. AI 生成与质量管线

现有 EvoLink 封装迁入 Provider 模块并改为 TypeScript。业务模块依赖内部 `AiProvider` 接口，不直接依赖 EvoLink 请求格式。

### 10.1 文章生成

1. 对用户输入做长度、字符和内容安全预检查。
2. 以结构化 JSON 数据嵌入提示词，明确把词义和原句视为数据，降低提示词注入风险。
3. 要求模型返回标题、段落、每个目标的实际表面词形、题目、四个选项与解释。
4. 从响应中提取 JSON，并通过 Zod 校验完整结构。
5. 确认目标 ID 完整且唯一、每个目标词形确实出现在指定段落、位置不重叠、题目恰有四个唯一选项。
6. 正确选项必须与用户给定中文义项保持一致；服务端不会信任模型自行指定的答案索引。
7. 发起第二次模型复核，检查目标义项在语境中是否成立、题目是否只有一个合理答案、文章是否自然且符合雅思路径。
8. 对最终文章、问题和解释执行 EvoLink 内容审核。
9. 全部通过后用一个数据库事务持久化不可变结果，并将练习置为 `ready`。

结构或质量失败最多重新生成两次。任务从创建起的总截止时间为两分钟；达到截止时间后进入最终失败并释放额度。网络错误、限流和供应商 5xx 使用带抖动的指数退避；确定性的非法输入不重试。

### 10.2 翻译

段落与全文翻译使用独立任务。缓存键由练习 ID、范围、段落 ID 和源文本 SHA-256 组成。翻译输出需通过非空、语言和内容审核检查。生成译文不直接算辅助；只有客户端展示后提交的 `assistance` 事件才影响答题证据。

## 11. 客户端接入

客户端新增：

- 首次年龄确认；
- API Client 与统一错误映射；
- 安装令牌的 SecureStore 管理；
- `/practice/new` 词义录入；
- `/practice/[id]/generating` 状态与恢复；
- `/practice/[id]/read` 分段文章、高亮和翻译；
- `/practice/[id]/quiz` 单选测验；
- `/practice/[id]/result` 结果摘要。

现有阅读首页提供明确的“创建练习”入口，词库页切换到真实接口。其他模拟 Tab 和视觉样式不在本轮整体重做。

非敏感的录入草稿、当前练习 ID、阅读位置和已经提交的问题 ID 使用 AsyncStorage 保存。安装令牌只使用 SecureStore。`EXPO_PUBLIC_API_BASE_URL` 是客户端唯一新增的公开配置，不包含密钥。

App 回到前台后会重新获取服务端练习状态。网络错误保留草稿和当前页面，提供重试；不会自动新建练习。准备完成的文章可以本地缓存以便崩溃恢复，但本轮不承诺完整离线答题同步。

## 12. 状态与一致性规则

- `practice_sessions` 只允许沿已定义状态图前进；最终失败和完成不能被普通重试覆盖。
- AI 成果、正确选项和首次答案是不可变事实。
- 只有服务器判断答案，客户端提交选项 ID。
- 练习只有在所有问题均有首次答案时才完成。
- 额度预留、练习创建和任务创建属于同一事务。
- 练习准备完成与额度确认属于同一事务。
- 练习最终失败与额度释放属于同一事务。
- 学习进度与首次答案在同一事务中更新；汇总可根据答案记录重建。
- Worker 写入结果前检查资源当前状态和租约所有权，因此过期 Worker 不能覆盖新结果。

## 13. 错误处理

稳定错误码至少包含：

- `VALIDATION_ERROR`
- `AGE_CONFIRMATION_REQUIRED`
- `UNAUTHORIZED`
- `TOKEN_REVOKED`
- `NOT_FOUND`
- `STATE_CONFLICT`
- `IDEMPOTENCY_KEY_REUSED`
- `FREE_LIMIT_REACHED`
- `RATE_LIMITED`
- `AI_UNAVAILABLE`
- `AI_INVALID_OUTPUT`
- `AI_CONTENT_REJECTED`
- `GENERATION_DEADLINE_EXCEEDED`
- `DATABASE_UNAVAILABLE`
- `INTERNAL_ERROR`

可重试错误返回 `retryable: true`，并在适用时附带 `Retry-After`。原始数据库错误、供应商响应、堆栈和提示词不会返回客户端。每个请求产生 `requestId`，用于把客户端错误与脱敏日志关联。

## 14. 安全与隐私

- 所有非健康检查接口都验证安装令牌和资源归属。
- 生产环境只允许 HTTPS，并配置明确的 Web CORS 来源。
- Fastify 请求体设定小型全局上限，具体 DTO 使用更严格上限。
- 按安装令牌和 IP 双层限流；匿名身份创建与 AI 任务使用更严格桶。
- 日志隐藏 `authorization`、Cookie、数据库连接、API Key、文章正文、原句、具体词义、译文和答题内容。
- 第三方 AI 请求不包含用户 ID、安装 ID、IP、数据库主键或其他可识别身份；目标词使用一次性随机别名关联生成结果。
- 用户输入不会拼接进系统指令，模型返回内容永远先校验后使用。
- SQL 只通过参数化 Drizzle 查询或明确参数化的原生 SQL 执行。
- 数据库迁移由显式命令执行；应用启动不会自动执行 destructive push 或重建 Schema。
- `.env` 被 Git 忽略；`.env.example` 只包含变量名和安全示例。

## 15. 配置

服务端验证以下环境变量：

- `DATABASE_URL`
- `EVOLINK_API_KEY`
- `EVOLINK_BASE_URL`
- `EVOLINK_TEXT_MODEL`
- `EVOLINK_MODERATION_MODEL`
- `EVOLINK_TIMEOUT_MS`
- `PORT`
- `HOST`
- `LOG_LEVEL`
- `CORS_ORIGINS`
- `FREE_PRACTICE_LIMIT`，默认 `3`
- `JOB_POLL_INTERVAL_MS`
- `JOB_LEASE_MS`
- `GENERATION_DEADLINE_MS`，默认 `120000`

客户端只读取：

- `EXPO_PUBLIC_API_BASE_URL`

开发配置失败时服务端立即退出，并只报告缺失的变量名，不输出变量值。

## 16. 测试策略

### 16.1 单元测试

覆盖：

- 词形和释义标准化、指纹与精确复用；
- 练习状态机；
- 辅助事件对目标的影响范围；
- 首次答案判定和学习进度累计；
- 免费额度预留、确认和释放；
- AI JSON 提取、Zod 校验、文本位置和选项唯一性；
- 错误到公开错误码的映射。

### 16.2 API 契约测试

使用 Fastify `inject`，不监听真实端口。覆盖成功响应、未授权访问、跨用户资源访问、边界输入、额度耗尽、幂等重放、幂等键误用和正确答案不提前泄漏。

### 16.3 数据库集成测试

测试优先使用 `TEST_DATABASE_URL`。若只提供 `DATABASE_URL`，测试运行器在该开发数据库中创建名称带随机后缀且强制以 `app_test_` 开头的隔离 Schema，所有连接固定 `search_path`；清理前再次验证前缀，只删除本次创建的 Schema。测试不删除、截断或重建 `public` Schema。

覆盖迁移、事务回滚、唯一约束、并发额度预留、并发首次答题和多个 Worker 领取同一任务。

### 16.4 AI 与端到端测试

常规测试使用实现同一 `AiProvider` 接口的固定假 Provider，不产生 API 费用。真实 EvoLink 测试必须显式运行并使用安全、短小的固定输入。

最终烟雾验收使用真实数据库和真实 EvoLink：创建匿名身份、录入至少三个词义、生成文章、请求段落和全文翻译、分别完成正确与错误作答、重启客户端后恢复，并确认相同幂等请求没有产生重复练习、答案或扣费。

## 17. 完成标准

本轮只有同时满足以下条件才算完成：

1. 一条开发命令可启动 API 和 Worker。
2. 迁移可以在空数据库上执行，并可重复检查而不破坏数据。
3. Expo 客户端可完成整个云端核心闭环。
4. AI 在两分钟内成功，或明确失败且不消耗免费额度。
5. 正确答案只在首次提交后出现。
6. 退出并重新打开客户端能恢复正在生成、阅读或测验的练习。
7. 所有密钥均未进入客户端 Bundle、日志、测试快照或 Git。
8. lint、类型检查、单元测试、API 测试和数据库集成测试通过。
9. 提供 `.env.example`、迁移命令、API 使用说明和本地启动说明。

## 18. 后续演进

后续阶段按独立设计处理：正式账号绑定与合并、文章导入与自动义项识别、动态间隔调度、完整离线同步、多设备冲突、商店订阅、质量举报与运营后台、备用 AI Provider、数据导出和账号删除。

这些扩展不得改变本轮保存的不可变答题事实。注册账号通过重新绑定 `user_id` 或受审计的合并事务继承匿名数据；正式掌握算法根据已有答案和辅助证据重新计算。

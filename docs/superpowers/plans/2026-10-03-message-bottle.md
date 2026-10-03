# 留言瓶实施计划

> 按 `2026-10-03-message-bottle-design.md` 中用户确认的实名方案逐项实施，在当前对话内完成并验证。

**目标：** 阅读和口语导航增加留言瓶，注册账号使用持久用户名提交反馈，所有用户查看完整公共留言列表。

**架构：** 共享严格 Zod 契约，Fastify／Neon 与 Cloudflare Worker／D1 提供相同行为。Expo 页面复用身份初始化、主题和布局，服务端原子绑定用户名并发布留言。

**技术栈：** Expo SDK 57、React Native、Fastify 5、Drizzle PostgreSQL、Cloudflare D1、Zod、Vitest、Jest。

## 全局约束

- 保留工作区已有改动；新增分支 `codex/message-bottle`。
- 用户名 2–24 字，规范化后唯一；内容去除首尾空白后 1–1,000 字。
- 只有注册账号可发布，安装身份可浏览；公开响应不含邮箱或内部用户 ID。
- 每账号 10 分钟最多 5 条新留言，幂等重放不重复计数。
- 迁移仅增量；集成测试仅操作随机 `app_test_*` Schema。
- 运行工作区检查、Cloudflare 验证、服务端构建和 Web 导出，不在本任务中部署生产。

## 任务一：契约与存储

**文件：** `packages/contracts/src/index.ts`、`packages/contracts/src/messageBottles.test.ts`、`server/src/db/schema.ts`、新 Drizzle 迁移、`cloudflare/api/migrations/0008_message_bottles.sql`。

**接口：** `CreateMessageBottleSchema`、`MessageBottleDtoSchema`、`MessageBottlePageSchema`、`MessageBottleProfileSchema`、`MessageBottleListQuerySchema`，以及各自推断类型。

```ts
type CreateMessageBottle = { username: string; content: string };
type MessageBottleDto = { id: string; username: string; content: string; createdAt: string; isMine: boolean };
type MessageBottlePage = { items: MessageBottleDto[]; nextCursor: string | null };
type MessageBottleProfile = { username: string | null; canPost: boolean };
```

- [x] 先写契约边界测试，执行 `npm test --workspace=@context-reader/contracts -- messageBottles.test.ts`，验证新导出尚未存在。
- [x] 增加用户名规范化、严格请求／响应和分页校验；重跑契约测试。
- [x] `users` 增加 `username`、`username_key`，后者建唯一索引；留言表增加作者关联、署名快照、内容和创建时间。
- [x] 执行 `npm run db:generate --workspace=@context-reader/server`，检查生成迁移仅增加本功能字段／表；编写对应 D1 SQL 并用本地 SQLite 测试执行全部迁移。

## 任务二：后端完整行为

**文件：** `server/src/modules/message-bottles/{service,routes}.ts`、对应集成测试、`server/src/modules/idempotency/service.ts`、`server/src/app.ts`、`cloudflare/api/src/message-bottles/{routes,routes.test}.ts`、`cloudflare/api/src/index.ts`。

**接口：** GET 和 POST `/v1/message-bottles`，GET `/v1/message-bottles/profile`。

- [x] 测试注册账号提交、游客拒绝、跨账号读取、用户名唯一及同账号固定署名、幂等重放／冲突、相同时间分页、超过发布上限。
- [x] Fastify 复用身份校验和现有幂等操作事务；按账号获取事务锁，读注册状态、旧用户名、幂等结果和最近发布数量，再原子绑定新用户名与留言。
- [x] Cloudflare 用 D1 batch 事务和现有幂等表；插入语句对账号、用户名和次数再次校验，失败时回滚首次用户名分配，竞争请求按最终记录返回相同结果。
- [x] 按 `created_at DESC, id DESC` 做游标查询，限量读取 `limit + 1` 条判断下一页；公开 DTO 只映射契约字段。
- [x] 注册两套路由；Neon 留言集成测试已纳入全量服务端检查，Cloudflare 本地 SQLite 测试通过。

## 任务三：导航与实名留言页面

**文件：** `app/src/api/messageBottles.ts`、`app/src/features/message-bottles/{MessageBottleScreen,useMessageBottles}.tsx`（hook 使用 `.ts`）、对应测试、`app/src/app/(tabs)/message-bottles.tsx`、`app/src/app/(tabs)/_layout.tsx`、`app/src/__tests__/tabs-layout.test.tsx`。

**接口：** `getMessageBottles(cursor?)`、`getMessageBottleProfile()`、`createMessageBottle(input, idempotencyKey)`。

- [x] 先写导航和页面行为测试，执行 `npm test --workspace=app -- message-bottles tabs-layout`，预期新入口和页面尚不存在。
- [x] 在「我的」前增加留言瓶标签，阅读和口语模式都显示。
- [x] API 模块使用共享 schema、安装身份和幂等键；页面聚焦时初始化身份并同时加载公共列表与发布资格。
- [x] 页面显示标题、公开署名提示、首次用户名输入或固定署名、多行反馈及提交状态。游客显示登录入口，列表独立可用。
- [x] 请求使用版本编号忽略失焦／旧请求；失败保留草稿，同一草稿重试复用幂等键；成功立即插入留言并更新最新列表，清空草稿。
- [x] 列表提供刷新、加载更多、空状态和重试，追加时按 ID 去重；使用主题、安全区与键盘避让适配手机和宽屏。
- [x] 重跑客户端测试，预期成功。

## 任务四：整体验证与交付

- [x] 执行 `npm run check`。
- [x] 执行 `npm run cloudflare:typecheck:api`，运行 Cloudflare 留言路由测试。
- [x] 执行 `npm run build --workspace=@context-reader/server`。
- [x] 执行 `npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke`。
- [x] 审查变更范围、请求日志脱敏、实名显示和迁移顺序；在设计稿记录验证结果并向用户说明结果。


## 验证结果

提交前完整 `npm run check` 已通过，包含 Neon 留言集成测试；客户端 599 项、服务端 494 项、契约 61 项、小程序 9 项测试全部通过。Cloudflare 类型检查及 157 项测试通过，客户端密钥泄漏检查通过。检查中发现的任务入队时钟差与租约测试时间边界已修复，具体记录见 ../../2026-10-03-message-bottle.md。未执行生产迁移和部署。

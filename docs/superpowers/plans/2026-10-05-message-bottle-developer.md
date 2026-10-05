# 留言瓶开发者模式实现计划

> 执行方式：使用 executing-plans，在当前会话中按任务实现并验证。用户已确认设计，无需重复确认。

**目标：** 开发者登录后在留言瓶审核和回复留言。

**架构：** Worker 使用安装身份与服务端账号 ID 白名单鉴权；复用审核动作，D1 保存每条留言的唯一开发者回复。Expo 以能力接口显示审核入口，回复通过显式参数兼容旧版客户端。

**技术栈：** Expo SDK 57、React 19.2、TypeScript、Zod、Cloudflare Worker/D1、Vitest、Jest。

## 全局约束

- 所有响应契约 `.strict()`，旧客户端不接收新字段。
- 账号外键均 `ON DELETE CASCADE`，不打印密钥或账号凭证。
- 文案与文档使用中文，Web 确认使用 `confirmAction`。
- 无新增依赖，不执行真实 AI 调用；D1 使用内存 SQLite，旧服务数据库测试只使用 app_test_* 隔离 Schema。

## 任务 1：契约、存储和服务端

文件：`packages/contracts/src/index.ts`、`cloudflare/api/migrations/0013_message_bottle_replies.sql`、`cloudflare/api/src/message-bottles/developer.ts`、`cloudflare/api/src/message-bottles/replies.ts`、`cloudflare/api/src/message-bottles/routes.ts`、`cloudflare/api/src/admin/moderation.ts`、`cloudflare/api/src/env.ts`、`cloudflare/api/src/index.ts`。

接口：`handleDeveloperMessageBottleRoute(request, env, userId): Promise<Response | null>`；`canModerateMessageBottles(env, userId): Promise<boolean>`。普通请求增加 `includeReply=1`，返回 `{ items: [...message, status, reply], nextCursor }`；能力返回 `{ canModerate: boolean }`。审核列表使用 `view: pending | reported | hidden | recent`、`limit`、`cursor`，动作返回 `{ ok: true }`，回复返回 `{ reply: { content, createdAt, updatedAt } | null }`。

- [x] 写 `developer.test.ts`，使用 `createTestD1()` 运行迁移并创建普通、游客、开发者身份；断言普通账号访问列表与每个变更返回 403，正常安装令牌只有白名单账号通过，未配置 `ADMIN_TOKEN` 时开发者仍可用。
- [x] 运行 `npx vitest run cloudflare/api/src/message-bottles/developer.test.ts`，验证新增开发者路由。
- [x] 增加严格契约与回复表。回复保存使用 `INSERT ... ON CONFLICT(bottle_id) DO UPDATE`，相同内容保持时间，删除使用绑定参数；普通列表批量查询回复，避免逐条查询。
- [x] 实现审核分页和服务端白名单；通过身份认证后才分发 `/v1/developer/*`，每次读取和写入均检查权限；复用原审核动作以解决举报和禁言。
- [x] 覆盖通过/隐藏/删除、回复增改删与幂等、屏蔽和举报可见性、旧响应、注销级联、同时间分页与无效参数，运行上述测试及原审核测试。

## 任务 2：客户端审核和回复

文件：`app/src/api/messageBottles.ts`、`app/src/api/messageBottleDeveloper.ts`、`app/src/features/message-bottles/useMessageBottles.ts`、`MessageBottleScreen.tsx`、`MessageBottleModeration.tsx`、`useMessageBottleModeration.ts` 与对应测试。

接口：`getMessageBottleDeveloperAccess()`、`getModerationBottles(view, cursor?)`、`moderateMessageBottle(id, action)`、`moderateMessageBottleAuthor(id, action)`、`saveMessageBottleReply(id, content)`、`deleteMessageBottleReply(id)`。前端通过 `apiRequest` 发送正常安装令牌，不存后台口令。

- [x] 写客户端行为测试：普通账号无入口，开发者可进入；回复失败保留草稿，成功刷新；公共卡片显示开发者回复；失去权限清空审核内容。
- [x] 普通 API 显式请求回复契约，能力单独读取；焦点变化清空身份相关状态，过期请求不能重新填入数据。
- [x] 审核组件显示四个筛选、分页与操作；回复编辑区支持字数、保存、取消、错误提示，删除与禁言通过现有确认组件。
- [x] 运行 `npm test --workspace=app -- --runTestsByPath src/api/messageBottles.test.ts src/features/message-bottles/MessageBottleScreen.test.tsx src/features/message-bottles/MessageBottleModeration.test.tsx`。

## 任务 3：文档和全量验证

文件：`cloudflare/README.md`、`cloudflare/api/wrangler.jsonc`、`app/src/features/legal/privacyPolicy.ts`、`docs/2026-10-05-message-bottle-developer.md`。

- [x] 记录账号 ID 授权、撤销与注销后行为，说明迁移先于 API 和客户端。用户已提供邮箱，已核对现有账号并设置 Worker secret；不向源码写入账号信息。
- [x] 同步隐私政策关于开发者查看与回复留言的说明。
- [x] 运行 `npm run check`、`npm run cloudflare:typecheck:api`、`npx vitest run cloudflare/api/src --maxWorkers=2 --testTimeout=30000` 和 Expo Web 导出；仅在新变更或失败时重复验证。
- [x] 检查差异和工作区状态，将完成代码回写原工作区并保留未提交改动；报告验证、账号绑定和发布状态。

## 验证记录

- 客户端：119 个测试套件、670 个测试通过。
- Worker：31 个测试文件、305 个测试通过，包含创建接口和幂等重放的旧客户端兼容性测试。
- 契约：7 个测试文件、77 个测试通过。
- 类型检查、客户端及服务端 lint、Expo Web 导出通过；客户端 lint 有 24 条既有告警。
- 客户端密钥扫描：957 个文件、6 项已配置服务端密钥，未发现泄漏；扫描规则已加入审核口令和开发者账号配置。
- 浏览器使用本地示例数据验证开发者回复、通过审核、普通用户无审核入口及查看公开回复，并检查 390 像素手机布局。
- 服务端构建通过。初次 `npm run check` 因远程 Neon 集成测试超时中断；发布前使用只监听本机的临时 PostgreSQL 17.11 重跑全量检查并通过：服务端 74 个文件、594 个测试；客户端 670 个测试；契约 77 个测试；小程序 9 个测试。数据库测试仍使用随机 `app_test_*` Schema，没有改动远程数据或跳过测试。
- 正式 Web 导出和压缩准备通过，对 483 个产物文件及 6 项服务端密钥扫描通过；确认正式 API 域名和开发者功能已进入产物，开发者白名单未进入产物。Worker 发布前打包检查通过。
- 已核对用户提供邮箱的现有账号并配置 Worker secret。发布前检查确认生产 D1 需要按顺序执行 0011、0012、0013；实际迁移、部署与 TestFlight 上传结果另行记录。

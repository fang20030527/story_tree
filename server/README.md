# Context Reader Server

Fastify 服务以模块化单体形式提供 HTTP API，并在同一进程启动基于 PostgreSQL 租约的生成与翻译 worker。所有业务状态均持久化，客户端重启后可按服务端状态继续。

## 启动生命周期

```bash
npm install
npm run db:migrate --workspace=@context-reader/server
npm run dev
```

`db:migrate` 是唯一迁移入口，API 启动时不会自动 push、删库或重建 Schema。启动顺序为：解析环境变量、建立数据库连接池、启动 Fastify、验证数据库就绪、启动 worker。收到 `SIGINT` 或 `SIGTERM` 后依次停止 worker、关闭 HTTP 服务和连接池。

必需变量为 `DATABASE_URL` 和 `EVOLINK_API_KEY`。完整变量列表与安全默认值见 `app/.env.example`。配置错误只报告变量名，不输出变量值。

## API 与状态

所有业务路由使用 JSON 并位于 `/v1`。客户端生成的安装令牌通过 `Authorization: Bearer ...` 传递；所有会改变资源的练习、翻译、辅助和作答请求都必须带 `Idempotency-Key`。

| 路由 | 成功状态 | 用途 |
| --- | --- | --- |
| `POST /v1/auth/anonymous` | `201` 或 `200` | 创建或恢复 14+ 匿名身份 |
| `POST /v1/practices` | `202` | 预留额度并创建生成任务 |
| `GET /v1/practices/:id` | `200` | 读取持久练习状态与建议轮询间隔 |
| `POST /v1/practices/:id/translations` | `200` 或 `202` | 读取缓存译文或创建翻译任务 |
| `GET /v1/translations/:id` | `200` | 读取翻译状态 |
| `POST /v1/practices/:id/assistance` | `200` | 在内容实际展示后记录辅助 |
| `POST /v1/practices/:id/answers` | `200` | 保存且只保存首次作答 |
| `GET /v1/vocabulary-items` | `200` | 游标分页的词义与进度 |
| `GET /v1/dashboard` | `200` | 未完成练习、统计和剩余额度 |
| `GET /health/live` | `200` | 进程存活，不调用数据库或 AI |
| `GET /health/ready` | `200` 或 `503` | 带超时的数据库就绪检查 |

练习状态为 `queued → generating → validating → ready → in_progress → completed`，任何生成终态错误进入 `failed`。翻译状态为 `queued → generating → ready`，终态错误进入 `failed`。

错误响应始终包含稳定的 `error.code`、可展示的中文 `message`、`requestId` 和 `retryable`。常见 HTTP 状态包括 `400` 输入错误、`401` 安装令牌无效、`403` 年龄/额度/来源限制、`404` 资源不存在、`409` 状态或幂等冲突、`413` 请求过大、`429` 限流、`502/503` AI 或数据库暂时不可用，以及 `500` 已脱敏的内部错误。

## 测试与隔离

```bash
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
npm run build --workspace=@context-reader/server
```

集成测试优先读取 `TEST_DATABASE_URL`，否则使用 `DATABASE_URL`。每个测试只会创建随机命名且强制匹配 `app_test_*` 的 Schema，所有连接的 `search_path` 均指向该 Schema；清理前会再次校验名称前缀。测试不会删除、截断或重建 `public` Schema。

## 真实服务冒烟验收

先启动已迁移的本地服务，再在另一终端运行：

```bash
npm run dev
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
```

脚本默认拒绝运行，只有显式设置 `RUN_LIVE_SMOKE=1` 才会创建全新匿名安装身份和三词练习。它会验证生成、段落/全文翻译、展示后辅助、一次正确作答、一次 `dont_know`、剩余额度和所有变更接口的幂等重放。输出只包含 ID、状态、计数、模型名和耗时，不打印词义、文章、译文或密钥。

该冒烟流程会在配置的真实数据库中留下一组带随机安装令牌的验收数据，并会调用真实 EvoLink API。

## Verified locally

2026-09-07 在 macOS 开发机完成以下验收，不包含文章正文、译文、用户输入或密钥：

- `npm run check` 通过：服务端 22 个测试文件、51 项测试，客户端 10 个测试文件、44 项测试，共享契约 1 个测试文件、9 项测试；所有 TypeScript 与 Expo lint 门禁通过。
- `npm run build` 通过，生成 Node.js 22 ESM 服务端产物。
- 对配置的 Neon 数据库连续执行两次迁移均成功，第二次未重复创建对象。
- 真实 Neon + EvoLink 冒烟流程通过：三词练习约 56.8 秒进入 `ready`，段落翻译与全文翻译均进入 `ready`，一次正确作答与一次 `dont_know` 均被接受；练习创建、翻译、辅助和作答的幂等重放均返回相同资源或结果，剩余免费额度为 2。
- Expo Web 开发模式已实际渲染首页和 `/practice/new`；生产导出成功生成 15 条静态路由。源码和导出包扫描未发现服务端变量名、PostgreSQL URL 或配置中的真实密钥值。
- 原生 iOS/Android 交互流程尚未验证：本机没有 `simctl` 或 `adb`。发布前仍需在一个可用的 iOS 或 Android 目标上完成 14+ 确认、后台恢复、阅读辅助、作答、结果页与重启恢复验收。

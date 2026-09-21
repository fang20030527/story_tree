# 黑洞英语 — AI 代理指南

## 项目概览

黑洞英语是一个云端生词长文练习工作区：Expo 客户端按单词查看复习安排并设置目标词数，Fastify 服务端使用 FSRS（间隔重复算法，ts-fsrs 5.4.2，目标保留率 0.90）优先选择待复习单词，在文章语境中练习具体含义，使用 Neon PostgreSQL 持久化数据，并由内置任务处理器通过 EvoLink API 生成阅读练习、导入英文文章和翻译。

核心领域规则：

- 同词不同释义共享一份复习计划；词库显示「全部／待复习／未到时间」，待复习数量来自整个词库。
- 练习状态机：`queued → generating → validating → ready → in_progress → completed`，终态错误进入 `failed`；翻译状态机为 `queued → generating → ready`。
- 文章导入状态机：`awaiting_upload → queued → processing → preview_ready → confirmed` 为常规成功路径，另有 `retryable`、`failed`、`expired`、`cancelled`。
- 免费额度通过 `usage_ledger`（reserve/commit/release）管理，默认 `FREE_PRACTICE_LIMIT=3`。
- 客户端可传入 `format: "topic_set"` 一次创建四篇 200–300 词的不同主题短文练习（需要迁移 0006）。

## 工作区结构（npm workspaces）

| 路径 | 包名 | 说明 |
| --- | --- | --- |
| `app/` | `app` | Expo SDK 57 客户端（iOS / Android / Web），expo-router，React 19.2，React Native 0.86 |
| `server/` | `@context-reader/server` | Fastify 5 API + PostgreSQL 任务队列 + 同进程 worker，ESM |
| `packages/contracts/` | `@context-reader/contracts` | 客户端与服务端共用的 Zod API 契约，直接以 TypeScript 源码导出 |
| `server/drizzle/` | — | 显式执行的数据库迁移（drizzle-kit 生成，含 meta 快照） |

根目录的 `render.yaml` 是 Render 部署配置；`tsconfig.base.json` 是所有服务端/契约包的公共严格配置（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）。

## 环境与配置

- 要求 Node.js ≥ 22.13 和 npm。
- 环境变量统一放在 `app/.env`（从 `app/.env.example` 复制），服务端的 `dev`、`db:migrate`、冒烟脚本都用 `node --env-file=../app/.env` 加载；**不要提交 `app/.env`**。
- 必需变量：`DATABASE_URL`、`EVOLINK_API_KEY`、无路径的绝对 HTTP(S) `PUBLIC_SERVER_ORIGIN`。配置错误只报告变量名，不输出变量值。
- 客户端只读取 `EXPO_PUBLIC_` 前缀的变量（`EXPO_PUBLIC_API_BASE_URL` 等）；数据库、EvoLink、微信 AppSecret 绝不能出现在客户端可见变量中。
- 真机调试时手机和开发电脑需在同一局域网，`EXPO_PUBLIC_API_BASE_URL` 与 `PUBLIC_SERVER_ORIGIN` 都要用开发电脑的局域网 IP（如 `http://192.168.1.20:3000`），不能用 localhost；切换 Wi-Fi 后需同时更新并重启 API 与 Expo。

## 常用命令

```bash
npm install
npm run db:migrate --workspace=@context-reader/server   # 新环境必须先显式迁移，可安全重跑
npm run dev          # 启动 HTTP API + 任务 worker + 导入清理器（tsx watch）
npm run dev:app      # expo start
npm run check        # 全工作区 typecheck + test + lint（提交前必须通过）
npm run build        # 构建服务端产物（tsup → server/dist，Node 22 ESM）
```

单个工作区：

- 服务端：`npm test --workspace=@context-reader/server`（vitest）、`typecheck`（tsc）、`lint`（eslint）。
- 客户端：`npm test --workspace=app`（jest + jest-expo，`--runInBand`）、`lint`（expo lint）。
- 契约：`npm test --workspace=@context-reader/contracts`（vitest）。
- 生产 Web 导出：`npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke`。
- 真实服务冒烟（默认拒绝运行，需显式环境变量，会调用真实 EvoLink 并写入真实数据库）：
  `RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server`
  `RUN_IMPORT_LIVE_SMOKE=1 npm run smoke:imports --workspace=@context-reader/server`
- 客户端密钥泄漏检查：`npm run check:client-secrets --workspace=@context-reader/server`。

## 服务端架构（`server/src/`）

模块化单体，同一进程内运行 HTTP API 和基于 PostgreSQL 租约的后台 worker。启动顺序：解析环境变量 → 建立连接池 → 启动 Fastify → 验证数据库就绪 → 启动清理器与 worker。`SIGINT`/`SIGTERM` 反向依次停止。

- `index.ts`：入口，组装应用、注册 job runner（任务类型见 `modules/jobs/types.ts`）。
- `app.ts`：`buildApp`，注册各模块路由、安全插件；日志 pino，对 authorization、cookie、body、密钥做 redact。
- `config/env.ts`：环境变量解析与校验（zod）。
- `core/errors.ts`：`AppError` 与稳定错误码。
- `db/schema.ts`：drizzle-orm 表定义（users、auth_identities、installations、vocabulary_words、vocabulary_items、practice_sessions、translations、imported_articles、article_imports、jobs、idempotency_records、usage_ledger 等约 20 张表）。
- `modules/`：按业务领域分模块（auth、practice、vocabulary、translation、article-translation、articles、imports、computer-upload、dashboard、quota、jobs、idempotency），每个模块内含 `routes.ts`、`service.ts`、`repository.ts`、`handler.ts`、状态机 `state.ts` 及配套测试。
- `infrastructure/ai/`：EvoLink client/provider、生成结果 zod 校验（`generated-schemas.ts`）、prompts，以及无凭证时测试用的 `fake-provider`。
- `plugins/security.ts`：CORS、限流等安全插件。
- `http/`：流式上传与校验工具。
- `scripts/`：live-smoke、import-live-smoke、check-client-secrets。

### API 约定

- 所有业务路由使用 JSON 并位于 `/v1`；健康检查为 `/health/live`、`/health/ready`。
- 安装令牌经 `Authorization: Bearer ...` 传递；所有改变资源的练习、翻译、辅助和作答请求必须带 `Idempotency-Key`。二进制资产 PUT 改用「导入 ID + 位置 + 服务端 SHA-256」实现安全重放。
- 错误响应统一包含 `error.code`、中文 `message`、`requestId`、`retryable`。响应和日志不得包含源 URL、文件名、上传码、正文、OCR Base64、数据库 URL 或 API key。
- 登录方式：匿名安装身份（14+ 确认）、邮箱+密码（服务端只存 scrypt 哈希，首次登录自动建号，不依赖外部邮件服务）、微信原生授权 code（需要真实开放平台凭证与 Expo Development Build，Expo Go 不含该原生模块）。

### 数据库与迁移

- 迁移唯一入口是 `npm run db:migrate --workspace=@context-reader/server`；API 启动时**不会**自动迁移。修改 Schema 后用 `npm run db:generate --workspace=@context-reader/server` 生成迁移，迁移是只增不改的（如 0005 只加表和回填，不删旧数据）。
- 生产环境用 `db:migrate:production`（运行 `dist/db/migrate.js`）。
- 导入临时二进制只存 Neon `bytea`；单资产 ≤ 10 MiB、批次 ≤ 30 MiB；可重试资产 TTL 24 小时，未确认预览 7 天，由清理器删除。
- URL 抓取有严格 SSRF 防护：仅公开 HTTP(S)，每次连接和重定向重新校验 DNS 并锁定解析结果，禁止私网/本机/保留/元数据地址。

## 客户端架构（`app/src/`）

- `app/`：expo-router 路由（`(tabs)` 标签页、practice、import 系列页面、login 等），路径别名 `@/* → src/*`。
- `api/`：服务端 API 客户端（practices、articles、imports、email、wechat 等），共用契约来自 `@context-reader/contracts`。
- `features/`：按领域组织的功能组件与 hooks（practice、imports、library、shelf、editorial、auth）。
- `components/`：通用 UI；`context/ThemeContext.tsx`：主题；`constants/theme.ts`：主题常量。
- 云端身份令牌使用 expo-secure-store（原生），因此完整业务流程需在 iOS/Android 上运行；Web 构建可用于开发冒烟。

## 代码风格

- 全仓库 TypeScript。服务端和契约走根 `tsconfig.base.json` 的严格模式（含 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）；服务端为 ESM（`"type": "module"`，`moduleResolution: Bundler`），内部导入写相对路径。
- 服务端 ESLint：`eslint.config.js` 使用 `@eslint/js` recommended + typescript-eslint recommended（带 projectService 类型感知），忽略 `dist/`、`coverage/`、`drizzle/`。客户端用 `eslint-config-expo`。
- API 请求/响应一律在 `packages/contracts/src/index.ts` 定义 zod schema（`.strict()`），客户端和服务端共享，不要各自手写类型。
- 错误用 `AppError` + 稳定错误码；面向用户的消息为中文。
- 文档、README、提交说明均使用中文。

## 测试策略

- 服务端：vitest，测试与源码同目录（`*.test.ts` 为纯单元测试，`*.integration.test.ts` 为数据库集成测试），`fileParallelism: false`、`pool: 'forks'`、超时 30 秒。
- 数据库集成测试优先读 `TEST_DATABASE_URL`，否则用 `DATABASE_URL`，但只创建并清理名称以 `app_test_*` 开头的随机隔离 Schema（所有连接 `search_path` 指向它，清理前再次校验前缀）；**绝不删除、截断或重建 `public` Schema**。
- 无微信/EvoLink 凭证时用假 provider 测试；真实联调需要配置凭证的自定义开发构建。
- 客户端：jest-expo，`src/**/*.test.[jt]s?(x)`，`moduleNameMapper` 把 `@/` 和 `@context-reader/contracts` 映射到源码。
- 契约包有自己的 vitest 测试（`packages/contracts/src/index.test.ts`）。

## 安全注意事项

- 密钥只在服务端：`DATABASE_URL`、`EVOLINK_API_KEY`、`WECHAT_APP_SECRET` 不得出现在客户端变量、响应或日志中。
- 电脑上传码（50 bit 空间）与能力 Cookie 均 10 分钟过期、单次使用，原值不入库；输码失败按 IP 和码摘要限流（10 分钟 5 次）。
- 无脚本桌面输码页通过 CSP、`nosniff`、`DENY`、`no-referrer`、`no-store` 检查。
- 粘贴正文上限 128 KiB，规范化后须为 20–5,000 个英文词，超限拒绝而非截断；扫描型 PDF 不在服务端渲染。

## 部署

- Render（`render.yaml`）：Node 运行时，build 命令 `npm ci && npm run build --workspace=@context-reader/server`，start 命令先 `db:migrate:production` 再 `npm run start`，健康检查 `/health/ready`；`DATABASE_URL`、`EVOLINK_API_KEY` 为手动配置的 sync:false 密钥。
- 升级顺序：先迁移数据库，再启动服务端和客户端。英文语境自测等新题型需要服务端和客户端一起更新，只影响更新后生成的练习，历史数据保留原题。

## 其他

- `app/AGENTS.md`：Expo 相关任务须查阅与 `package.json` 版本匹配的官方文档（当前 SDK 57：https://docs.expo.dev/versions/v57.0.0/）。
- `PRD.md`：产品需求文档；`docs/superpowers/`、`app/.claude/` 下有辅助工作流资料。

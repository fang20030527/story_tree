# 黑洞英语服务端

Fastify 服务以模块化单体形式提供 HTTP API，并在同一进程启动基于 PostgreSQL 租约的生成与翻译 worker。所有业务状态均持久化，客户端重启后可按服务端状态继续。

## 启动生命周期

```bash
npm install
npm run db:migrate --workspace=@context-reader/server
npm run dev
```

`db:migrate` 是唯一迁移入口，API 启动时不会自动 push、删库或重建 Schema。迁移使用持久记录，可安全重跑。启动顺序为：解析环境变量、建立数据库连接池、启动 Fastify、验证数据库就绪、启动清理器与 worker。收到 `SIGINT` 或 `SIGTERM` 后依次停止清理器、worker、HTTP 服务和连接池。

必需变量为 `DATABASE_URL`、`EVOLINK_API_KEY` 和无路径的绝对 HTTP(S) `PUBLIC_SERVER_ORIGIN`。完整变量列表与安全默认值见 `app/.env.example`。配置错误只报告变量名，不输出变量值。

Expo Go 真机调试要求手机和 API 主机可在同一局域网互访。`EXPO_PUBLIC_API_BASE_URL` 和 `PUBLIC_SERVER_ORIGIN` 应同时指向开发机当前的局域网 origin。切换 Wi-Fi 导致 IP 改变时，更新两者并重启 API 与 Expo。

## API 与状态

所有业务路由使用 JSON 并位于 `/v1`。客户端生成的安装令牌通过 `Authorization: Bearer ...` 传递；所有会改变资源的练习、翻译、辅助和作答请求都必须带 `Idempotency-Key`。

| 路由 | 成功状态 | 用途 |
| --- | --- | --- |
| `POST /v1/auth/anonymous` | `201` 或 `200` | 创建或恢复 14+ 匿名身份 |
| `POST /v1/auth/email` | `201` 或 `200` | 用邮箱和密码创建或恢复注册身份 |
| `POST /v1/auth/wechat` | `201` 或 `200` | 用原生微信授权 code 绑定或恢复注册身份 |
| `POST /v1/practices` | `202` | 预留额度并创建生成任务 |
| `GET /v1/practices/:id` | `200` | 读取持久练习状态与建议轮询间隔 |
| `POST /v1/practices/:id/translations` | `200` 或 `202` | 读取缓存译文或创建翻译任务 |
| `GET /v1/translations/:id` | `200` | 读取翻译状态 |
| `POST /v1/practices/:id/assistance` | `200` | 在内容实际展示后记录辅助 |
| `POST /v1/practices/:id/answers` | `200` | 保存且只保存首次作答 |
| `POST /v1/word-translations` | `200` | 按语境查询一个单词或短语的词性与中文义项 |
| `POST /v1/vocabulary-items` | `201` | 幂等保存一个阅读中选定的词义 |
| `GET /v1/vocabulary-items` | `200` | 游标分页的词义与进度 |
| `GET /v1/dashboard` | `200` | 未完成练习、统计和剩余额度 |
| `POST /v1/imports` | `201` | 创建 URL、粘贴、相册或本地文件导入 |
| `PUT /v1/imports/:id/source-text` | `200` | 流式上传粘贴的 UTF-8 正文 |
| `PUT /v1/imports/:id/assets/:position` | `200` | 按清单位置上传一个二进制资产 |
| `POST /v1/imports/:id/process` | `202` | 验证资产完整性并创建解析/OCR 任务 |
| `GET /v1/imports/:id` | `200` | 读取所有者的导入状态与轮询间隔 |
| `PATCH /v1/imports/:id/preview` | `200` | 编辑标题和正文并重算查重指纹 |
| `POST /v1/imports/:id/confirm` | `200` | 原子确认文章和有序段落 |
| `POST /v1/imports/:id/retry` | `202` | 在资产有效期内重试可重试导入 |
| `POST /v1/imports/:id/cancel` | `200` | 取消导入并删除临时资产 |
| `GET /v1/articles/:id` | `200` | 所有者读取私有文章和有序段落 |
| `POST /v1/articles/:id/translations` | `200` 或 `202` | 读取缓存或创建段落/全文翻译 |
| `GET /v1/article-translations/:id` | `200` | 读取私有文章翻译状态 |
| `POST /v1/computer-upload-sessions` | `201` | 创建十分钟电脑上传码和导入 |
| `GET /v1/computer-upload-sessions/:id` | `200` | 手机端轮询上传与导入状态 |
| `GET /computer-upload` | `200` | 无脚本桌面输码页 |
| `POST /computer-upload/claim` | `200` | 同源认领码并设置临时 HttpOnly Cookie |
| `POST /computer-upload/file` | `200` | 单次 multipart 文件上传 |
| `GET /health/live` | `200` | 进程存活，不调用数据库或 AI |
| `GET /health/ready` | `200` 或 `503` | 带超时的数据库就绪检查 |

练习状态为 `queued → generating → validating → ready → in_progress → completed`，任何生成终态错误进入 `failed`。翻译状态为 `queued → generating → ready`，终态错误进入 `failed`。

文章导入可见状态为 `awaiting_upload`、`queued`、`processing`、`retryable`、`preview_ready`、`confirmed`、`failed`、`expired` 和 `cancelled`。只有 `awaiting_upload → queued → processing → preview_ready → confirmed` 为常规成功路径；后台自动重试会从 `processing` 返回 `queued`，耗尽自动尝试后才进入可显式重试的 `retryable`。电脑会话状态为 `awaiting_code → claimed → uploaded`，未上传的会话到期进入 `expired`。

JSON 变更接口、粘贴正文 PUT 和电脑会话创建要求 `Idempotency-Key`。原始资产 PUT 不使用该请求头，而是按 `(导入 ID，位置，服务端 SHA-256)` 实现安全重放；同一位置不得被不同内容替换。

错误响应始终包含稳定的 `error.code`、可展示的中文 `message`、`requestId` 和 `retryable`。常见 HTTP 状态包括 `400` 输入错误、`401` 安装令牌、邮箱密码或微信授权 code 无效、`403` 年龄/额度/来源限制、`404` 资源不存在、`409` 状态、幂等或账号合并冲突、`413` 请求过大、`429` 限流、`502/503` AI、微信或数据库暂时不可用，以及 `500` 已脱敏的内部错误。认证相关错误码为 `EMAIL_AUTH_FAILED`、`WECHAT_NOT_CONFIGURED`、`WECHAT_AUTH_FAILED` 和 `AUTH_ACCOUNT_CONFLICT`。

导入相关公开错误码为 `IMPORT_UNSUPPORTED_TYPE`、`IMPORT_TOO_LARGE`、`IMPORT_CONTENT_INVALID`、`IMPORT_NOT_ENGLISH`、`IMPORT_FETCH_BLOCKED`、`IMPORT_FETCH_FAILED`、`IMPORT_PARSE_FAILED`、`IMPORT_OCR_FAILED`、`IMPORT_DEADLINE_EXCEEDED`、`UPLOAD_SESSION_EXPIRED`、`UPLOAD_SESSION_USED` 和 `SIMILAR_ARTICLE_REQUIRES_DECISION`。响应和日志不会包含源 URL、文件名、上传码/Cookie、正文、OCR Base64、数据库 URL 或 API key。

## 导入边界与清理

- 粘贴源最多 128 KiB，规范化后必须是 20–5,000 个英文词；超限时拒绝而不是截断。
- 单资产最多 10 MiB，批次总计最多 30 MiB，相册最多 10 张。上传字节只临时保存在 Neon `import_assets.content bytea`。
- 成功预览、终态失败、取消、过期和审计清理会删除字节。可重试资产的 TTL 为 24 小时，未确认预览为 7 天。
- 文本 PDF 直接提取；扫描 PDF 不会在服务器渲染，应导出页面图片后从相册导入。
- URL 抓取仅支持公开 HTTP(S)，禁止凭据、本机/私网/保留/元数据地址，每次连接和重定向都重新验证 DNS 并锁定全部解析结果。后端不执行页面 JavaScript，不绕过登录、付费墙、反爬或 robots 限制。
- 电脑上传码具有 50 bit 空间，与能力 Cookie 均十分钟过期且单次使用；原值不入库。输码失败同时按 IP 和码摘要限制为十分钟内五次。

## 测试与隔离

```bash
npm test --workspace=@context-reader/server
npm run typecheck --workspace=@context-reader/server
npm run lint --workspace=@context-reader/server
npm run build --workspace=@context-reader/server
npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke
npm run check:client-secrets --workspace=@context-reader/server
```

集成测试优先读取 `TEST_DATABASE_URL`，否则使用 `DATABASE_URL`。每个测试只会创建随机命名且强制匹配 `app_test_*` 的 Schema，所有连接的 `search_path` 均指向该 Schema；清理前会再次校验名称前缀。测试不会删除、截断或重建 `public` Schema。

微信登录的 provider HTTP client 和假 provider 集成路径可以在没有凭证时测试；数据库身份绑定测试需要可连接的 PostgreSQL。真实微信联调还需要运行 `npm install` 后用 `EXPO_PUBLIC_WECHAT_APP_ID` 配置自定义开发构建，并在服务端配置对应的 `WECHAT_APP_ID`/`WECHAT_APP_SECRET`。

邮箱登录不依赖外部邮件服务：首次使用 `POST /v1/auth/email` 会创建邮箱账号，之后用同一邮箱和密码恢复身份。服务端只保存 scrypt 密码哈希；邮箱验证码、找回密码和邮箱所有权验证尚未接入。

## 真实服务冒烟验收

先启动已迁移的本地服务，再在另一终端运行：

```bash
npm run dev
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
RUN_IMPORT_LIVE_SMOKE=1 npm run smoke:imports --workspace=@context-reader/server
```

两个脚本默认都拒绝运行。练习脚本只有显式设置 `RUN_LIVE_SMOKE=1` 才会创建全新匿名安装身份和三词练习，并验证生成、翻译、辅助、作答、额度与幂等重放。导入脚本只有显式设置 `RUN_IMPORT_LIVE_SMOKE=1` 才会验证 URL、粘贴、两张有序图片、内存 DOCX 和电脑上传，再确认私有文章、段落/全文翻译、幂等重放和临时资产清理。输出只包含来源类型、UUID、状态、计数、模型名和耗时，不打印输入、文章、译文、URL、上传码/Cookie 或密钥。

该冒烟流程会在配置的真实数据库中留下一组带随机安装令牌的验收数据，并会调用真实 EvoLink API。

## Verified locally

2026-09-09 已完成邮箱登录，并完成微信接入基础的静态验证：

- 新增 WeChat OAuth code exchange client、`auth_identities` 数据表/迁移、安装令牌绑定和显式账号冲突保护；客户端保留微信原生适配入口，但当前登录页使用邮箱登录。
- 共享契约、服务端类型检查、服务端 lint、WeChat provider 单元测试和客户端 Jest 测试通过。
- 未配置真实 AppID/AppSecret，未完成真实微信客户端和可连接数据库上的端到端验收；不能把当前状态视为已上线。

2026-09-09 在 macOS 开发机完成文章导入后端验收：

- `npm run check` 通过：服务端 42 个测试文件、172 项测试，客户端 10 个测试文件、44 项测试，共享契约 1 个测试文件、12 项测试；所有 TypeScript 与 lint 门禁通过。服务端 build 与包含 15 条静态路由的 Expo Web 生产导出成功；94 个客户端源码/导出文件的变量名和真实密钥值扫描通过。
- 对配置的 Neon 数据库连续执行两次迁移均成功，并验证六张导入表及两类后台任务枚举均存在。
- 真实粘贴文本、两张有序图片 OCR、内存 DOCX 和电脑文件来源均进入可编辑预览并确认成私有文章；段落/全文翻译均进入 `ready`，终态导入未残留临时资产。
- 当前网络的 TUN/DNS 将公开测试域名解析到保留的 `198.18.0.0/15` 网段，因此 URL 来源被 `IMPORT_FETCH_BLOCKED` 正确拒绝；未为验收降低 SSRF 防护。
- 当前 EvoLink 账户调用默认 DeepSeek Vision 模型返回 HTTP 403；仅在本地环境改用已验证可用的 `gemini-3.8-flash` 完成真实图片 OCR，仓库默认配置保持不变。
- Google Chrome 152.0.7977.83 完成无脚本电脑上传：同源输码、文件提交和手机侧同一导入 ID 轮询成功，提交后约 11 秒进入 `preview_ready`；浏览器重复提交返回“已完成或已被使用”。响应同时通过 CSP、`nosniff`、`DENY`、`no-referrer` 和 `no-store` 检查。

2026-09-07 在 macOS 开发机完成以下验收，不包含文章正文、译文、用户输入或密钥：

- `npm run check` 通过：服务端 22 个测试文件、51 项测试，客户端 10 个测试文件、44 项测试，共享契约 1 个测试文件、9 项测试；所有 TypeScript 与 Expo lint 门禁通过。
- `npm run build` 通过，生成 Node.js 22 ESM 服务端产物。
- 对配置的 Neon 数据库连续执行两次迁移均成功，第二次未重复创建对象。
- 真实 Neon + EvoLink 冒烟流程通过：三词练习约 56.8 秒进入 `ready`，段落翻译与全文翻译均进入 `ready`，一次正确作答与一次 `dont_know` 均被接受；练习创建、翻译、辅助和作答的幂等重放均返回相同资源或结果，剩余免费额度为 2。
- Expo Web 开发模式已实际渲染首页和 `/practice/new`；生产导出成功生成 15 条静态路由。源码和导出包扫描未发现服务端变量名、PostgreSQL URL 或配置中的真实密钥值。
- 原生 iOS/Android 交互流程尚未验证：本机没有 `simctl` 或 `adb`。发布前仍需在一个可用的 iOS 或 Android 目标上完成 14+ 确认、后台恢复、阅读辅助、作答、结果页与重启恢复验收。

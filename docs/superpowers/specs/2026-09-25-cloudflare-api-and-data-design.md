# Cloudflare 免费套餐全量迁移设计

- 日期：2026-09-25
- 状态：按用户确认的 Workers、D1、R2 免费套餐方案实施；当前进度见 `cloudflare/README.md`

## 目标

让 Expo Web 和新版 iOS/Android 的业务请求由 Cloudflare 处理，停止依赖 Render 运行 API 和后台任务。保留现有用户、词库、练习、文章与导入记录；2026 年外刊录音继续放在私有 R2 桶。所有核心功能和现有 `/v1` 契约保持可用，采用 Cloudflare 免费套餐，不自动升级付费计划。

## 现状与约束

现有 Render 服务由 Fastify HTTP 进程、PostgreSQL 连接池、两个常驻任务循环和清理循环组成。Neon 数据库约 58 MB、25 张表。业务代码使用 PostgreSQL 事务、`FOR UPDATE`、`SKIP LOCKED`、枚举、`bytea` 和专有 SQL；D1 是 SQLite，不能直接导入 PostgreSQL 数据或复用这些查询。现有 PDF/DOCX、图片和 HEIC 解析分别依赖 `pdf-parse`、`mammoth`、`sharp` 和 `heic-convert`。

[Workers Free](https://developers.cloudflare.com/workers/platform/limits/) 每日 100,000 次请求、每次 HTTP/Cron 调用 10 ms CPU、128 MB 内存。网络等待不计入 CPU；超限时请求会失败。[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) 全账户包含 5 GB 存储、每日 500 万行读取和 10 万行写入；[单库上限](https://developers.cloudflare.com/d1/platform/limits/) 为 500 MB、单次 Worker 调用最多 50 条查询、SQL 语句最多 100 KB。现有 2026 音频占 R2 约 8.38 GB；[R2 免费量](https://developers.cloudflare.com/r2/pricing/) 在账户内所有桶共享 10 GB-month。临时导入资产必须限额、到期删除，避免挤占音频空间。

## 方案选择

1. **Workers + D1 + R2（目标方案）**：把 HTTP、任务和数据库都迁到 Cloudflare。最符合“全部迁移”，但必须把 PostgreSQL 存储层与并发控制改写为 D1 原子 SQL，并做一次性数据转换。
2. **Workers + Neon Hyperdrive + R2（缩短切换路径）**：保留 PostgreSQL 模型与历史数据，改造 HTTP 和任务入口。Cloudflare 负责计算，Neon 继续存数据；若用户明确允许数据库暂留 Neon，可改用此方案。[Hyperdrive Free](https://developers.cloudflare.com/hyperdrive/platform/pricing/) 每日包含 100,000 条数据库语句。
3. **Workers Paid 或 Containers**：放宽 CPU 限制，但违反“先用免费套餐”的要求，本次不采用。

## 目标架构

```text
Expo Web / iOS / Android
        │  /v1 与健康检查
        ▼
waikan-web Worker ──Service Binding──► waikan-api Worker
        │                                ├─ D1：业务与任务状态
        │                                ├─ R2：限时导入资产
        │                                ├─ Queues：异步任务
        │                                ├─ Workers AI：PDF/DOCX 转正文
        │                                ├─ Images：图片缩放与 HEIC 转码
        │                                ├─ EvoLink：练习、翻译和 OCR
        │                                └─ Resend：密码重置邮件
        └─ 静态 Web、插图与现有音频 Worker ──► 私有 R2 2026 音频
```

API Worker 复用 `packages/contracts` 的 Zod 契约和纯业务规则，把 HTTP 入口改成 Workers `fetch`。每个请求创建短生命周期的数据访问上下文；任务处理改由 Cloudflare Queues 触发，定时清理与过期任务恢复使用 Cron。D1 事务以 `batch()` 和带条件的原子写入实现，不把原有 `FOR UPDATE` 语义假装成 SQLite 锁。数据库迁移采用版本化 SQLite SQL，保留外键、唯一约束和幂等键。

文件上传直接写入私有 R2 的临时前缀，只在 D1 保存元数据与校验值。PDF/DOCX 使用 [Workers AI 文档转换](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/) 提取文字；图片使用 [Images 免费转换额度](https://developers.cloudflare.com/images/pricing/) 生成 OCR 所需的尺寸与格式。URL 导入继续逐跳限制公开 HTTP(S) 地址、响应大小和耗时。用户已接受 Cloudflare 出站隔离替代原来的连接前 DNS 校验和 IP 固定；两者并不等价。

## 数据与切换

实现分成可核对的阶段：先在未公开的 Worker 中移植 HTTP 入口，并可暂借 Neon 验证 PostgreSQL 兼容路径；随后移植 D1 schema、业务模块、队列和文件处理。这个中间 Worker 不接生产写流量，不算完成迁移。当前限时部署令牌只能编辑 Workers 脚本，不能管理 D1 或 Hyperdrive；创建这些资源需要使用已登录的 Cloudflare 控制台或另行获得相应权限。

先建新的 D1 schema，再从 Neon 做只读快照，逐表转换并核对行数、主键、关联、关键状态和可用配额。活跃导入资产迁到 R2，完成校验后才允许新 Worker 处理队列。切换期间短暂冻结写入，导入最后增量并核对，然后把 `waikan-web` 的 `/v1` 绑定到新 API。新版移动端使用 Cloudflare 地址；已安装旧版若仍指向 Render，则保留兼容转发直到覆盖率允许停用。Render/Neon 不删除，作为可回滚快照保留。

Resend 使用已验证的 `no-reply@danceclip.org`，API key 仅作为 Worker secret 保存。创建新 key 前沿用浏览器要求取得用户当次确认，且不得在日志、仓库或客户端输出密钥。

## 验收与回滚

切换条件：新 Worker 的认证、词库、练习生成与作答、文章导入、翻译、密码重置、外刊与健康检查均与现有契约一致；队列任务可完成或正确重试；迁移记录核对无缺失；免费额度可承载现有数据。切换后观测 CPU 超限、D1 行数额度、Queue 积压、R2 存储与 Resend 投递。任何关键功能或数据核对失败，`waikan-web` 恢复指向旧 API，暂停新写入并处理差异，避免双向覆盖数据。

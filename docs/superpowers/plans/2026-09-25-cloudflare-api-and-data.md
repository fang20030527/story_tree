# Cloudflare 免费套餐全量迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将黑洞英语的业务 API、后台任务和数据从 Render/Neon 切换到 Cloudflare Workers、D1 和 R2，保留现有功能与历史数据。

**Architecture:** `waikan-api` Worker 通过 Service Binding 接入现有 `waikan-web`。D1 保存业务状态，R2 保存限时导入资产；Queues 处理 AI 任务，Cron 清理和恢复；Workers AI 与 Images 承担文件转换。Render/Neon 保持只读回滚快照直到切换完成。

**Tech Stack:** TypeScript、Cloudflare Workers Free、D1、R2 Standard、Queues、Workers AI、Images、Expo SDK 57、EvoLink、Resend。

## Global Constraints

- 不升级 Cloudflare Workers Paid；遵守每次请求 10 ms CPU、128 MB 内存、每天 100,000 次请求。
- R2 所有桶合计每月 10 GB-month 免费存储，现有 2026 音频已占约 8.38 GB。
- 不向客户端、日志或仓库暴露数据库、EvoLink、Resend 和 R2 密钥。
- 保持 `/v1` 契约、幂等键、中文错误码、14 岁确认及词库复习规则。
- 用户随后要求先核验免费套餐 CPU 再切换；已进行合成负载核验，并允许针对迁移代码运行隔离测试。真实 EvoLink 冒烟脚本仍须在切换窗口单独评估。

---

### Task 1: Worker 入口与资源配置

**Files:** Create `cloudflare/api/wrangler.jsonc`, `cloudflare/api/src/index.ts`; modify `package.json`, `cloudflare/README.md`.

- [ ] 建立 `waikan-api` 的 `fetch`、`queue`、`scheduled` 入口和无密钥的健康检查。
- [ ] 为 D1、R2、Queue、AI、Images 定义绑定；所有 API key 用 Worker secrets。
- [ ] 在现有 Cloudflare 账户创建仅免费资源；记录资源 ID，不提交任何凭证。
- [ ] 用 `wrangler deploy --dry-run` 检查打包；发布到独立 `workers.dev` 域名，不切生产流量。

### Task 2: D1 schema 与数据访问

**Files:** Create `cloudflare/api/migrations/0001_initial.sql`, `cloudflare/api/src/db/*`, `scripts/migrate-neon-to-d1.mjs`.

- [ ] 将 25 张 PostgreSQL 表的列、索引、唯一约束和外键映射到 SQLite；在 D1 建立版本化迁移。
- [ ] 用 D1 `batch()`、条件更新与 `RETURNING` 实现原子配额、幂等与任务抢占；不保留无效的 `FOR UPDATE` 查询。
- [ ] 编写只读 Neon 导出和 D1 导入脚本，支持中断重试与逐表行数、主键及关系核对。
- [ ] 临时导入资产从 PostgreSQL `bytea` 迁入 R2；D1 仅存元数据和校验值。

### Task 3: 认证、词库与阅读基础 API

**Files:** Create `cloudflare/api/src/auth/*`, `cloudflare/api/src/vocabulary/*`, `cloudflare/api/src/articles/*`; modify `packages/contracts/src/index.ts` only if迁移所需契约确有变化。

- [ ] 移植匿名安装、邮箱、微信、密码重置流程，保持现有账号和安装令牌可用。
- [ ] 移植词库全部、待复习、未到时间视图和 FSRS 更新规则。
- [ ] 移植文章、仪表板及外刊目录 API；媒体继续由独立 Workers/R2 提供。
- [ ] 将敏感接口限流状态持久化，避免多地区 Worker 实例各自重置计数。

### Task 4: 练习、翻译与异步任务

**Files:** Create `cloudflare/api/src/practice/*`, `cloudflare/api/src/translation/*`, `cloudflare/api/src/jobs/*`.

- [ ] 维持练习、翻译及四篇主题短文的状态机、配额 reserve/commit/release 和幂等响应。
- [ ] 写入 D1 任务后向 Queues 发送任务 ID；消费者从 D1 原子领取并处理 EvoLink 响应。
- [ ] Cron 恢复超时租约、重试任务并清理过期状态；限制每次调用 CPU 用量。
- [ ] 在未公开的 Worker 中完成关键流程的部署检查，再允许新流量。

### Task 5: 导入与电脑上传

**Files:** Create `cloudflare/api/src/imports/*`, `cloudflare/api/src/computer-upload/*`; modify `app/src/app/import.tsx` only if文件上传契约变化。

- [ ] 保留粘贴、公开 URL、相册、本地文件和电脑上传入口及原有限制。
- [ ] 文件字节写私有 R2 临时前缀，D1 保存位置、大小、SHA-256 与期限。
- [ ] PDF/DOCX 用 Workers AI `toMarkdown` 提取；图片和 HEIC 用 Images 变换后送 EvoLink OCR。
- [ ] 逐跳校验公开 URL、限制响应大小和耗时；按用户确认使用 Cloudflare 出站隔离，不声称保留原来的 DNS/IP 固定语义。
- [ ] Cron 到期清理 R2 临时资产和预览草稿，确保 R2 仍低于共享免费容量。

### Task 6: 数据切换、Resend 与发布

**Files:** Modify `cloudflare/web/src/index.ts`, `cloudflare/web/wrangler.jsonc`, `app/.env.example`, `cloudflare/README.md`, `render.yaml` only where needed; create migration核对记录于 `docs/`。

- [ ] 在获得用户当次凭证创建确认后，建立仅限 `danceclip.org` 发信的 Resend key，作为 Worker secret 保存；发件地址为 `no-reply@danceclip.org`。
- [ ] 暂停旧 API 写入，执行 Neon 最后增量导出、D1 导入与完整性核对。
- [ ] 将 Web 的 `/v1` 由 Render 代理改为 API Service Binding；新版移动端指向 Cloudflare。
- [ ] 完成正式部署与健康、关键业务状态检查；旧版客户端需要时保留 Render 兼容转发。
- [ ] 记录 R2、D1、Workers、Queues 和 Images 免费额度基线；确认回滚入口后才结束迁移。

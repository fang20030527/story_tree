# 口语发音评分实施计划

> **执行要求：** 按 `superpowers:executing-plans` 工作流逐项实施，用复选框记录完成状态。

**目标：** 原阶段提供 Speechace Basic 逐词发音评分；用户随后选择低成本 EvoLink 音频点评，按文末后续任务调整。

**架构：** 复用短录音私有上传。共用严格契约与 Speechace HTTP 适配器；Fastify／Neon 与 Cloudflare／D1 分别提供事务占有、评分存储和结果查询。同步评测有持久状态，重复请求复用已有结果。

**技术栈：** TypeScript、Zod、Expo SDK 57、Fastify 5、Drizzle PostgreSQL、Cloudflare Workers／D1／R2、Vitest、Jest。

## 全局约束

- 单句录音最长 30 秒、最大 2 MiB；上游超时默认 20 秒，处理状态失效时间为 45 秒。
- 用户必须登录才能评分；本地素材允许受限字幕快照，云端素材须校验字幕原文和版本。
- 不修改现有用户的未提交封面和素材调整；新增配置不得泄漏服务端密钥。
- 每账号每天默认最多 50 次新评测，缓存命中及幂等重放不增加调用数。
- 所有文案与文档为中文；新增数据库迁移只增不改。
- 用户已确认设计并授权实施，继续执行，无须重复请求方案或执行方式确认。

## 任务 1：共享契约和评分适配器

**文件：** `packages/contracts/src/index.ts`、`packages/contracts/src/pronunciation.test.ts`、`server/src/infrastructure/speech/speechace.ts`、`server/src/infrastructure/speech/speechace.test.ts`。

**接口：**

```ts
type SpeakingPronunciationLocale = 'en-us' | 'en-gb';
type CreateSpeakingPronunciationRequest = {
  assetId: string; materialId: string | null; cueId: string;
  referenceText: string; subtitleRevision: number | null;
  locale: SpeakingPronunciationLocale;
};
type SpeakingPronunciationResult = {
  score: number;
  words: Array<{ word: string; score: number | null; startMs: number | null;
    endMs: number | null; phonemes: Array<{ symbol: string; spokenSymbol: string | null;
    score: number | null; stressScore: number | null; startMs: number | null; endMs: number | null }> }>;
  feedback: string[];
};
```

- [x] 添加状态严格校验和无效输入／响应测试；命令 `npm test --workspace=@context-reader/contracts`，必须全部通过。
- [x] 实现 `SpeechaceProvider.assess({ audio, contentType, referenceText, locale })`，使用官方区域映射与 multipart，仅请求 Basic 字段。
- [x] 单元测试固定上游 FormData、词音素字段、百分制范围、非 JSON 错误、静音与密钥脱敏；命令 `npm test --workspace=@context-reader/server -- src/infrastructure/speech/speechace.test.ts`。

## 任务 2：Fastify 评分和 Neon 增量迁移

**文件：** `server/src/modules/speaking/pronunciation.ts`、`pronunciation-shared.ts`、`pronunciation.integration.test.ts`、`routes.ts`、`server/src/db/schema.ts`、新增 `server/drizzle/0014_*.sql`、`server/src/config/env.ts`、`server/src/core/errors.ts`、`app/.env.example`。

**接口：** POST 返回 `SpeakingPronunciationAssessmentDto`；GET 按账号和 ID 查询同一 DTO。结果字段 `result`，错误字段 `error`，两者由 `status` 严格约束。

- [x] 在事务中先回放幂等记录，再校验录音／字幕并锁定账号；相同指纹的 ready 或 processing 记录直接返回。
- [x] 占有新 processing 记录后读取音频并调用 provider，持久保存 ready／failed；GET 将过期 processing 转为 failed。
- [x] 通过 `npm run db:generate --workspace=@context-reader/server` 生成迁移，禁止手改旧迁移。配置缺失仅禁用评分。
- [x] 以隔离 app_test_* schema 验证账号隔离、原文冲突、同键／不同键并发复用、明确失败后的新键重试；测试注入 provider，禁止付费调用。

## 任务 3：Cloudflare 正式路径

**文件：** `cloudflare/api/src/speaking/pronunciation.ts`、`pronunciation.test.ts`、`routes.ts`、`assets.ts`、`cloudflare/api/src/env.ts`、新增 `cloudflare/api/migrations/0006_speaking_pronunciation.sql`。

**接口：** 与任务 2 同一路径、同一契约、同一 provider 与共享输入校验。

- [x] 使用 D1 batch 的事务与现有 speaking_idempotency 门控插入，避免并发请求重复占有上游调用。
- [x] 从 SPEAKING_BUCKET 读取已验证的私有录音，检查实际读取长度上限；不能调用 FFmpeg 或接受外部音频 URL。
- [x] SQLite 测试执行全部 D1 迁移，验证请求重放、并发、失败重试、额度和资产归属。
- [x] 运行 `npm run cloudflare:typecheck:api` 与 Cloudflare Vitest 回归。

## 任务 4：录音快照、上传和评分 UI

**文件：** `app/src/api/speaking.ts`、`app/src/features/speaking/model.ts`、`ShadowingRecording.tsx`、新增 `pronunciation.ts`、`SpeakingPronunciation.tsx` 及对应测试；`cloudSync.ts` 只保留录音快照所需元数据。

**接口：** `submitSpeakingPronunciation({ materialId, material, scope, recording, locale, capability })` 返回 DTO；查询与 POST 都按账号、录音和 locale 绑定。

- [x] 录音开始时捕获 `cueId`、`referenceText`、`subtitleRevision`；停止／重试保存使用捕获值，不读取当前字幕覆盖它。
- [x] 新录音没有旧评分；未登录和没有快照的录音显示具体操作提示。共享素材／云端录音复用已有资产；本地短录音按现有媒体上传流程提交。
- [x] 评分组件显示整体分、逐词分、音素符号和中文提示；低分词可展开音素信息。口音变化单独查询对应评分。
- [x] 同一动作网络重试保留幂等键；失败后的明确重试创建新键。并发／卸载／重录后旧响应不得覆盖当前结果。
- [x] Jest 验证快照绑定、评分呈现、请求重试、录音保存字段保留和账号切换。

## 任务 5：完整回归与使用说明

**文件：** 新增 `docs/2026-10-02-speaking-pronunciation.md`、本计划任务状态。

- [x] 执行 `npm run check`；类型检查、现有与新增测试、Lint 全部无错误。
- [x] 执行 Cloudflare 全部测试与类型检查、`npm run build --workspace=@context-reader/server`、Web 导出及 `npm run check:client-secrets --workspace=@context-reader/server`。
- [x] 核对新增配置仅为变量名，并记录配置方法、每日限额、Basic 功能范围、尚未真实联调的部分。
- [x] 自审并核对本功能与必要的回归修复差异；保留用户原有未提交变更。没有凭证时保留完整代码与测试，向用户明确真实评分尚待配置密钥验证。

### 原 Speechace 实现阶段的验证记录

- `npm run check`：客户端 93 组／495 项、服务端 64 组／436 项、契约 3 组／55 项、小程序 9 项测试通过；所有工作区类型检查通过，Lint 为 0 错误、24 条现有客户端警告。
- Cloudflare API：14 组／130 项测试及类型检查通过；Worker dry-run 打包、服务端构建、Web 导出和客户端密钥检查通过。
- 浏览器使用测试分数验证单词展开、缺失音素分和手机宽度下的面板滚动，截图见 `docs/visual-preview/frontend/speaking-pronunciation.jpg`。
- 完整回归发现并修复新词分类的时间边界，以及测试数据库连接初始化失败的重试与连接池释放；未重放业务写入。
- 未配置 Speechace 凭证，未调用付费评测、执行生产迁移或部署。

## 后续任务：用户选择低成本方案（2026-10-02）

- [x] 复用现有服务端 EvoLink 密钥，默认 Gemini 2.5 Flash；原始音频使用 Gemini 原生接口，关闭思考并限制输出长度。
- [x] 共用契约区分 AI 参考点评和历史声学评测，新结果不生成音素或逐词分数。
- [x] 两套后端明确持久保存来源，缓存包含模型和点评版本；新键换模型可重新点评，同键安全重放。
- [x] 仅增加 Neon 0015 与 D1 0007 迁移，不修改之前的迁移和旧结果。
- [x] 客户端标明 AI 参考分，展示实际听到的英文及中文建议；更新使用说明。
- [x] 真实 WAV、M4A、WebM 短句与静音接口验证通过，共四次受限调用。
- [x] 完整回归、客户端密钥检查、执行用户已请求的配置与迁移并记录结果。

### 低成本方案的最终验证记录

- `npm run check`：客户端 93 组／497 项、服务端 65 组／481 项、契约 3 组／56 项、小程序 9 项测试通过；所有工作区类型检查通过，Lint 为 0 错误、24 条现有客户端警告。
- Cloudflare API：14 组／131 项测试及类型检查通过；Worker dry-run 打包、服务端构建、Web 导出通过。客户端密钥检查扫描 858 个文件，未发现已配置密钥泄漏。
- 已复用现有服务端 `EVOLINK_API_KEY`，本地配置使用 Gemini 2.5 Flash、20 秒超时、每账号每日 50 次新尝试；私有环境文件保持忽略。正式 Worker 已有 EvoLink 加密密钥。
- 已通过规定入口执行 Neon 0014／0015 和正式 D1 0006／0007 迁移；D1 再检查显示没有待执行迁移。旧记录和业务数据保留。
- 真实短句的 WAV、M4A、WebM 请求通过，三秒静音被拒绝，共四次受限调用；这些样本验证接口和格式，不代表专业发音评分准确度。
- 开发 API 已启动，`/health/ready` 返回 200；正式 API 与 Web 尚未发布，环境范围选择仍待用户回复。用户其他未提交改动保留。

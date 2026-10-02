# 口语 AI 点评（低成本 EvoLink 方案）

用户在 2026-10-02 选择低成本方案。新点评使用 EvoLink 的 Gemini 音频模型，复用现有服务端 `EVOLINK_API_KEY`，不再需要 Speechace 订阅或新密钥。录音面板显示「AI 口语点评」，包含 AI 参考分、清晰度／流畅度／完整度参考分、实际听到的英文、最多三条词语练习建议和三条中文整体建议。

参考分是通用音频模型的判断，不是经过校准的声学测量或考试成绩。新结果不生成逐词、音素分数和对齐时间，无法判断的维度保留 `null`。历史 Speechace 结果仍按原来源读取。

## 服务配置

密钥仅保存在服务端，不使用 `EXPO_PUBLIC_` 前缀，不写入代码、日志或客户端包。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `EVOLINK_API_KEY` | 现有凭证 | 复用阅读和翻译的 Key |
| `EVOLINK_BASE_URL` | `https://direct.evolink.ai/v1` | 共享现有配置；音频调用同一 origin 的 Gemini 原生接口 |
| `EVOLINK_AUDIO_MODEL` | `gemini-2.5-flash` | 音频专用，与生成文章的模型独立；也支持 `gemini-2.5-flash-lite` |
| `EVOLINK_AUDIO_TIMEOUT_MS` | `20000` | 整体超时，允许 1000–25000 毫秒 |
| `SPEAKING_COACH_DAILY_LIMIT` | `50` | 每账号每天新尝试数，按 UTC 日期；包括失败尝试 |

旧 `SPEECHACE_*` 变量不会启用新点评。Flash Lite 更便宜，但切换前应使用自己的录音比较点评质量；当前默认使用已完成真实接口验证的 Flash。

Fastify／Neon 开发环境加载被 Git 忽略的 `app/.env`。先执行迁移，再启动或重启 API：

```powershell
npm run db:migrate --workspace=@context-reader/server
npm run dev
```

正式版仍使用 Cloudflare／D1，不能切回旧 Neon 生产写入路径。Worker 复用已有加密 `EVOLINK_API_KEY`；其余三个非密钥配置可放在 Wrangler `vars`，未填写时使用默认值。正式升级先运行 `npm run cloudflare:d1:migrate:api`，再运行 `npm run cloudflare:deploy:api`，最后更新客户端。

迁移只增不改：Neon `0014_wooden_kid_colt.sql` 增加记录表，`0015_good_luminals.sql` 增加来源字段；D1 对应为 `0006_speaking_pronunciation.sql` 和 `0007_speaking_ai_coaching.sql`。来源字段默认 `speechace` 保留旧数据，新记录明确写入 `evolink`。没有字幕快照的旧录音需重录。

## 音频、缓存和费用控制

- 每次针对一条英文字幕，最长 30 秒、最大 2 MiB；录音开始时捕获字幕编号、英文原文和版本。
- 服务端读取账号私有录音，以 Base64 `inlineData` 提交原始音频；不会把识别文本冒充音频评测，也不发送录音公开 URL。M4A 规范化为 `audio/m4a`，WebM 使用 `audio/webm`。
- Gemini 原生 `generateContent` 使用 Bearer 身份，关闭额外思考（`thinkingBudget: 0`），输出上限 1536 token；不启用搜索或额外工具，不自动重试收费请求。
- 云端素材校验原文与版本；登录用户的本地素材允许受限字幕快照。录音读取最多 10 秒，处理记录 45 秒失效。
- 新缓存包含账号、录音、字幕、口音、来源、模型和点评版本；旧专用评分不会冒充新点评。相同成功结果直接复用，处理中只查询进度。
- 网络响应丢失时使用原幂等键重放；同键在更换模型后仍返回原记录。明确失败后仅在用户点击重试时使用新键。
- 每日额度只统计新尝试。缓存命中、进度查询和幂等重放不增加调用数；更换模型后主动创建新尝试会计数。
- 前端缓存加入点评版本；换句、重录、切换口音或账号时，旧响应不会覆盖当前结果。结果独立保存，临时录音清理后仍可读取已完成点评。
- 输入和输出长度、范围、词语归属及中文建议均校验。错误不包含密钥、原始音频或上游正文。

## 接口与验证

继续使用 `POST /v1/speaking/pronunciation-assessments` 和 `GET /v1/speaking/pronunciation-assessments/:id`。POST 需要 Bearer 身份与 `Idempotency-Key`；能力接口的 `pronunciation.provider` 为 `evolink`。新结果带 `kind: "ai_coaching"`，`words` 固定为空数组，包含 `transcript`、三个可空的维度分、`wordTips` 和 `feedback`。共享严格 Zod 契约区分新点评和历史专用评测。

开发验证使用本机生成的短句「Stay curious.」：WAV、M4A、WebM 都能听到原句并返回中文建议，耗时约 3 秒；三秒静音返回 `PRONUNCIATION_NO_SPEECH`，不会显示假分数。开发阶段进行了四次受限的真实样本请求，自动测试全部使用假 provider。正式发布时另用同一句 WAV 完成一次真实录音上传与点评，并验证幂等重放、成功缓存和历史查询返回同一结果；验证账号和私有测试对象已清理。样本验证了接口、格式和拒绝静音的行为，不能证明专业纠音准确度。

自动验证覆盖原始音频载荷、token 上限、思考关闭、缺失分数、异常输出、错误脱敏、超时、账号隔离、历史来源、模型缓存隔离、并发去重、失败重试及客户端展示。数据库集成测试只使用随机隔离的 `app_test_*` Schema。

本地已复用现有 EvoLink Key 并配置默认模型、超时和每日限额；Neon 的 0014／0015 与正式 D1 的 0006／0007 迁移均已执行。用户于 2026-10-02 授权推送 main 和正式 Web 上线，配套 API 与 Web 均已发布到 [黑洞英语](https://blackholeenglish.com)。正式 API 两项健康检查返回 200，录音上传、EvoLink 音频点评与中文反馈通过，浏览器确认「AI 口语点评」入口和来宾登录提示正常显示。

Cloudflare 实际运行时不接受 `redirect: "error"`；共享适配器改为 `redirect: "manual"`，拒绝 3xx 响应且不跟随跳转。新增实际 Workers 运行时的假上游回归测试，以及四项跳转拒绝测试。

原 R2 上传凭证于 10 月 1 日失效，发布时已更换为相同单桶 Object Read & Write 权限、相同一周期限的凭证，私有环境文件与 Worker 加密 secrets 已同步。新凭证有效至 **2026-10-09**，届时需要续期；密钥不进入 Git。正式版范围、版本和验收记录见 [Web 发布记录](2026-10-02-speaking-coach-web-release.md)。

完整回归通过：客户端 497 项、服务端 481 项、契约 56 项、小程序 9 项，所有工作区类型检查通过；Lint 为 0 错误、24 条现有客户端警告。Cloudflare API 的 131 项测试和类型检查、Worker dry-run、服务端构建与 Web 导出通过。客户端密钥检查扫描 858 个文件，未发现已配置密钥泄漏。

发布使用提交文件和锁文件安装依赖的独立工作区，保留此前已上线的封面与真实素材，并排除尚未完成的字幕文档导出。此发布包客户端 89 组／480 项、Cloudflare 131 项和契约 56 项回归通过；兼容性修复后相关 3 个文件／67 项测试、服务端与 Cloudflare 类型检查、服务端 Lint 再次通过。生产 Web 导出 39 条路由，密钥检查扫描 1066 个文件和六项实际配置密钥，无泄漏。

官方参考：[EvoLink 原生接口](https://evolink.ai/docs/en/api-manual/language-series/gemini/native-api/native-api-reference)、[Gemini 2.5 Flash 价格](https://evolink.ai/gemini-2-5-flash)、[按量计费](https://evolink.ai/pricing)、[Google 音频输入](https://ai.google.dev/gemini-api/docs/audio)、[Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)。

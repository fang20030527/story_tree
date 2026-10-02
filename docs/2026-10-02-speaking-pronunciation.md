# 口语逐句发音评分

口语跟读的录音面板支持 Speechace Basic 专用发音评测。登录后录制一条英文字幕，选择美式或英式，点击「发音评分」。结果包括句子发音分、逐词分、可展开的音素分和最多三条中文练习提示。未提供的音素分显示「未评分」。本功能不请求流利度、语调或 IELTS 分数。

## 启用服务

服务端必须具备已有的私有录音存储和 Speechace Basic 凭证。凭证仅保存在服务端，不能使用 `EXPO_PUBLIC_` 前缀，不能写入提交文件或客户端包。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SPEECHACE_API_KEY` | 未配置 | Speechace 发音评测密钥；未配置时评分入口提示暂未开放 |
| `SPEECHACE_REGION` | `ap-southeast` | 与密钥对应区域一致；支持 `us-west`、`ap-southeast`、`eu-west`、`ap-south` |
| `SPEECHACE_TIMEOUT_MS` | `20000` | 上游请求与响应读取的整体超时；允许 1000–25000 毫秒 |
| `SPEECHACE_DAILY_LIMIT` | `50` | 每账号每天的新评测尝试上限，按 UTC 日期计算；允许 1–10000 |

Fastify／Neon 本地环境：根据 `app/.env.example` 在被 Git 忽略的 `app/.env` 中配置上述变量，执行新增迁移后重启 API。

```powershell
npm run db:migrate --workspace=@context-reader/server
npm run dev
```

Cloudflare／D1 正式环境：使用 Worker 加密 secret 配置密钥。区域、超时和限额如需改变，可在 `cloudflare/api/wrangler.jsonc` 的 `vars` 中配置。迁移和部署按以下顺序执行；这些命令会改变正式服务，本次实现未执行。

```powershell
node --env-file=cloudflare/.env.local node_modules/wrangler/bin/wrangler.js secret put SPEECHACE_API_KEY --config cloudflare/api/wrangler.jsonc
npm run cloudflare:d1:migrate:api
npm run cloudflare:deploy:api
```

Neon 新增迁移 `server/drizzle/0014_wooden_kid_colt.sql`；D1 新增 `cloudflare/api/migrations/0006_speaking_pronunciation.sql`。两者只增加评分表，不修改历史录音。客户端与 API 一起更新；已有录音未保存字幕快照时，重新录制后可评分。

## 录音、字幕和重试

- 每次针对一条英文字幕，录音最长 30 秒、最大 2 MiB。录音开始时保存字幕编号、英文原文和版本。
- 云端素材的原文和版本必须与服务端一致。字幕已改变时提示重新录制。登录用户的本地素材可提交录音时的字幕快照。
- 评分独立按账号、录音、字幕和口音保存。换句、重录、切换口音或账号后，旧响应不会覆盖当前评分。
- 云端录音复用已有资产；本地录音先私有上传，保持本机录音可回放。临时上传沿用 24 小时有效期，过期后再次点击评分可重新上传。
- 相同录音和口音的成功结果直接复用。处理中只查询进度；网络响应丢失时保留原幂等键重放，避免再次评测。
- 明确失败后只在用户点击重试时创建新尝试。上游超时后的重试可能产生新的服务商费用，不自动重试。
- 新尝试计入每日限额，包括失败尝试；缓存命中、进度查询、网络重放不增加次数。音频读取整体最多 10 秒，45 秒未完成的处理记录转成可重试失败。
- 评分结果独立保存，临时录音清理后仍可查询已完成结果。

## 接口和验证

新增 `POST /v1/speaking/pronunciation-assessments`、`GET /v1/speaking/pronunciation-assessments/:id`。POST 使用现有 Bearer 身份及 `Idempotency-Key`；`GET /v1/speaking/capabilities` 增加可选 `pronunciation` 字段，兼容尚未升级的后端。请求、结果和错误均通过共用 Zod 契约校验。

两条后端的 POST 均在处理中返回 HTTP 202，在成功或已保存失败结果时返回 HTTP 200。读取结果和缓存重放都不会触发新的评测。

自动化验证使用注入的测试评测器，不调用付费服务。覆盖字幕快照、逐词和音素展示、异常响应、账号隔离、并发去重、失败重试、限额、临时资产过期、读取超时和客户端密钥检查。数据库测试仅使用随机隔离的 `app_test_*` Schema。

本次全量回归还修正了两个现有边界：从未练习的新词始终归为新词，避免数据库时间略超前时暂时显示「未到时间」；数据库测试连接初始化的只读检查允许有限重试，失败路径会关闭连接池，不重放迁移或业务写入。

已完成评分相关客户端 65 项测试、评分 PostgreSQL 5 项测试、契约包 55 项测试、Speechace 适配器 63 项测试、Cloudflare API 130 项测试、服务端与 Worker 打包、Web 导出及客户端密钥检查。浏览器还使用测试分数验证了逐词展开和手机宽度下的面板滚动，截图保存在 `docs/visual-preview/frontend/speaking-pronunciation.jpg`。

最终 `npm run check` 已通过：客户端 495 项、服务端 436 项、契约 55 项及小程序 9 项测试全部通过；各工作区类型检查通过，Lint 无错误，有 24 条现有客户端警告。

本次环境未配置 Speechace 凭证，尚未完成真实音频联调，也未执行生产迁移或部署。启用后应使用一条清晰短句核对整体分、逐词展开、英美口音及重录流程。

官方参考：[Speechace Score Text](https://api-docs.speechace.com/api-reference/score-text)、[区域端点](https://api-docs.speechace.com/getting-started/api-regions-and-endpoints)、[套餐](https://www.speechace.com/api-plans/)、[Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)。

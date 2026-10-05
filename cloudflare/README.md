# Cloudflare 部署

本目录部署四个独立项目：`waikan-audio`（私有 R2 音频接口）、`waikan-images`（外刊插图静态资源）、`waikan-web`（Expo Web 静态页面）和 `waikan-api`（业务 API）。音频 R2 桶为 `waikan-2026-audio`，Standard 存储类，不启用公共访问。2026 年全部 2,725 个 MP3 共 8,383,477,481 字节；其中 2,674 个文章可播放，51 个未匹配文件只归档。

2026-10-01 增加阅读／口语切换与口语业务。三部有字幕电影已迁入同一私有桶，视频约 3.75 GB；桶总量约 12.13 GB，已超过此前 10 GB 存储免费额度。Workers 仍使用原来的套餐和服务绑定。当前发布与实测记录见 [口语 Web 发布报告](../docs/2026-10-01-speaking-web-release.md)。

`waikan-api` 已发布在独立的 `workers.dev` 地址，绑定 SQLite Durable Object `CpuBoundary`、D1、私有 R2、Images、Workers AI、插图 Worker、Queue 和每分钟 Cron，并配置 EvoLink 和 Resend Worker secrets。Resend 发信密钥限定为 `blackholeenglish.com`，密码重置发件地址为 `no-reply@blackholeenglish.com`。D1 `waikan-core` 已应用 `0001`、`0002`、`0003` 三份迁移，其中 `0003` 增量保存网页图片和视频元数据；导入 Neon 数据（25 张表、985 行）。2026-09-25 04:18 UTC 暂停 Render 后导出的最终快照与已导入快照逐表摘要一致，D1 重新核对通过。`API_STAGE_OPEN=true`，`/health/live` 和 `/health/ready` 均返回 200。正式 `waikan-web` 已通过 Service Binding 把同源 API 转发到 Cloudflare。

## 免费额度边界

- R2 Standard 每个 Cloudflare **账户**每月包含 10 GB-month 存储、100 万次 Class A 操作和 1000 万次 Class B 操作；所有桶共享额度。2026-09-25 仪表盘显示全账户总存储 8.41 GB（音频桶 8.38 GB，其他项目图片桶约 26.83 MB，临时导入桶 0 B），Class A 约 2.85k 次、Class B 约 8.15k 次。`waikan-imports-temp` 已设置全桶八天后删除规则；仍需检查月平均用量。静态插图约 1.34 GB、17,164 文件，独立静态资源项目不占 R2 音频空间。
- [Workers Free](https://developers.cloudflare.com/workers/platform/limits/) 每日 100,000 次请求，每次 HTTP 请求只有 10 ms CPU。邮箱 scrypt 和 4,510 词长文规范化已在目标免费账户进行合成核验，Durable Object 日志显示约 239–253 ms CPU 且执行成功。首次答题的同词 FSRS 历史重放也已搬入 Durable Object，本地 D1 验证了原子提交和提示词失败规则；并发竞态及真实流量仍须核验。[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) 全账户每日 500 万行读取、10 万行写入；[Queues Free](https://developers.cloudflare.com/queues/platform/pricing/) 每日 10,000 次操作。
- 不启用 Workers Paid、Containers 或 Infrequent Access。[R2 免费额度](https://developers.cloudflare.com/r2/pricing/)用完后按实际用量计费；预算提醒不能代替存储硬上限。上述 2026-09-25 用量是增加电影之前的记录，当前固定素材不占个人文件配额。

## 口语素材与大文件上传

`0005_speaking.sql` 只新增六张口语表，素材、字幕覆盖、笔记、录音和练习记录按用户隔离，既有账号和阅读数据继续由 D1 提供。先执行 D1 增量迁移，再发布 API，最后发布 Web；不要把口语写入切回旧 Neon 服务。

API 的 `SPEAKING_BUCKET` 绑定现有 `waikan-2026-audio`。`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET_NAME` 必须使用 `wrangler secret bulk` 或 `wrangler secret put` 安全配置，不能写入 Wrangler `vars` 或任何客户端变量。固定影片在 `speaking/platform/`，Worker 摘要清单在 `speaking/platform/release/catalog.json`，每份完整字幕按需读取独立的 `<素材 ID>/material.json`。这些发布对象由 `server/content/speaking/catalog.json` 与其 `cloud-catalog.json` 生成；摘要只返回公开素材信息，不返回内部存储键。

发布脚本 `npm run cloudflare:publish:speaking` 默认只核对现有影片大小、类型和 SHA-256 元数据；维护目录时执行 `npm run cloudflare:publish:speaking -- --apply`，逐份验证详情后最后替换摘要。脚本只从服务端环境读取凭据，不上传或改写电影文件。

个人音视频最大 3 GiB，每个账号已绑定和未过期上传合计最多 10 GiB。客户端通过十分钟 S3 PUT 签名直传 R2，签名绑定对象键、真实字节数、Content-Type 和 `If-None-Match:*`，重复写入返回 412；账号 Bearer 令牌只发送到业务 API。桶 CORS 允许实际 Web 来源的 GET／HEAD／PUT、Range、Content-Type 和 If-None-Match，桶本身保持私有。

上传完成后客户端发送 `POST /v1/speaking/assets/:id/complete` 和 `{duration}`，API 核对实际对象大小、类型、文件头与 ETag，再确认 D1 资产。Web 从实际媒体元数据读取时长，无法读取时不确认成功；Cloudflare 不运行 FFprobe，不宣称对每份个人文件进行了服务端音轨和完整时长探测。原 Fastify 上传路径继续使用 FFprobe 校验。

较大的字幕 JSON 通过现有 SQLite Durable Object 处理，避免在外层 Worker 执行整片字幕解析。未绑定的个人资产 24 小时后由 Cron 先在 D1 事务中释放归属，再重试删除 R2 对象；固定素材和已绑定文件不在清理范围。播放签名有效十分钟，播放器提前续期并保留位置。

## 单账号无限练习

D1 迁移 `0004_user_practice_access.sql` 为注册账号增加练习次数豁免。`user_practice_access.unlimited_practices=1` 表示永久豁免；登录、dashboard、练习创建及详情均读取同一开关。创建时的原子 SQL 直接检查账号开关，不依靠给账本增加一个很大的余额，既有 reserve/commit/release 记录继续保留。

部署顺序为先 `npm run cloudflare:d1:migrate:api`，再 `npm run cloudflare:deploy:api`，最后只为指定邮箱设置权限：

```powershell
node --env-file=cloudflare/.env.local scripts/set-practice-access.mjs --email user@example.com --unlimited
```

恢复普通次数限制时使用 `--limited`。脚本只修改唯一、有效且未删除的注册账号，并在写入时再次核对邮箱归属，完成后回读验证。凭据只从环境读取，不进入命令参数或输出。

兼容旧客户端的 `remainingFreePractices` 字段在无限模式返回 `Number.MAX_SAFE_INTEGER` 标记，实际次数豁免由数据库开关执行。服务端发布后已安装的客户端可以直接使用，不需要为这个账号重新打包。此权限范围为练习生成次数，身份验证、请求频率和单次输入规范继续执行。

## 用户名

D1 迁移 `0009_usernames.sql` 只为已注册账号回填 `users.username`（列和唯一索引由 `0008` 创建，不改表结构）。新增 `GET /v1/account` 和 `PUT /v1/account/username`，`POST /v1/auth/email` 增加可选的 `username`，响应结构不变。回填规则、兼容性和上线检查见 [用户名](../docs/2026-10-04-username.md)。

部署顺序：先 `npm run cloudflare:d1:migrate:api`，再 `npm run cloudflare:deploy:api`，最后发布 Web 和原生客户端。新版客户端提交 `username` 时旧版 API 会拒绝，所以不能先发布客户端。

## 自测题数

每篇短文的自测至少 6 题。目标词少于 6 个时，同一目标词会在新的句子里再出题，每词最多 3 题（规划见 `server/src/infrastructure/ai/article-metrics.ts` 的 `planQuestionCounts`）；目标词够多时仍是每词一题。D1 迁移 `0010_question_rounds.sql` 为 `practice_questions` 增加 `round`，并把唯一约束由 `(practice_target_id)` 改为 `(practice_target_id, round)`。SQLite 只能通过重建表来删除表级唯一约束，而 `answer_attempts` 以 `ON DELETE CASCADE` 引用该表，D1 又不能关闭外键，所以迁移先备份并清空答案、重建两张表、还原并核对行数，最后才删除备份。追加题（`round > 0`）只作练习强化，不参与复习排期，也不累加 `learning_progress`。详见 [自测题数](../docs/2026-10-04-self-test-questions.md)。

部署顺序：先 `npm run cloudflare:d1:migrate:api`，再 `npm run cloudflare:deploy:api`。新版 API 不能在没有 `round` 列的库上运行；旧版 API 在迁移后仍可使用。客户端不需要重新发布。

## 每日额度、AI 上限与留言审核

D1 迁移 `0011_daily_quota.sql` 新增设备/网络额度事件表 `quota_usage_events`、全站 AI 调用计数表 `ai_usage_daily` 和账本索引；`0012_message_moderation.sql` 为留言增加 `status`，新增举报、屏蔽和禁言表。两份迁移只增不改，旧版 API 在迁移后仍可运行。

`wrangler.jsonc` 的 `vars` 里有 `FREE_PRACTICE_LIMIT`、`FREE_PRACTICE_IP_DAILY_LIMIT`、`AI_DAILY_CALL_LIMIT` 和 `MESSAGE_BOTTLE_REVIEW`，按需调整后重新发布。`ratelimits` 绑定 `IP_RATE_LIMITER` 取代每个请求一次的 D1 限流写入；如果部署时账户不支持该绑定，删除这一节即可，代码会退回 D1 计数。审核后台用 Worker secret `ADMIN_TOKEN`（至少 24 位）启用，可选 `MODERATION_NOTIFY_EMAIL` 接收待审提醒，两者都只用 `wrangler secret put` 配置。

部署顺序：先 `npm run cloudflare:d1:migrate:api`，再设置 secret、`npm run cloudflare:deploy:api`，最后发布 Web 和原生客户端。新客户端依赖新接口，不能先于 API 发布。详见 [账号合规、每日额度、留言审核与加载速度](../docs/2026-10-05-account-quota-moderation.md)。

## 留言瓶开发者模式

应用内审核使用正常登录账号，Worker secret `DEVELOPER_USER_IDS` 为已注册账号的 UUID 白名单（英文逗号分隔）。登录后在「留言瓶 → 开发者模式」查看待审核、被举报、已隐藏和全部留言，支持审核、禁言及开发者回复。权限每次由服务端校验；不填写白名单时入口关闭。

先应用 D1 迁移 `0013_message_bottle_replies.sql`，再配置 secret、发布 API，最后发布 Web/原生客户端。已有 `ADMIN_TOKEN` 审核网页保持可用。开发者回复按留言保存，跟随留言可见性，账号注销或留言删除时级联清理。账号查询、授权、撤销与接口兼容说明见 [留言瓶开发者模式](../docs/2026-10-05-message-bottle-developer.md)。

## 准备与上传

根目录执行 `npm ci`。把 `cloudflare/.env.example` 复制为被 Git 忽略的 `cloudflare/.env.local`，填写只对 `waikan-2026-audio` 桶有 Object Read & Write 权限的限时 R2 S3 凭证。**不要提交或打印凭证**。

```powershell
$audioRoot = 'D:\电脑操作\Economist_Audio\2026'
node scripts/upload-economist-2026-r2.mjs $audioRoot
Get-Content cloudflare/.env.local | ForEach-Object {
  $pair = $_ -split '=', 2
  if ($pair.Count -eq 2) { [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process') }
}
node scripts/upload-economist-2026-r2.mjs $audioRoot --upload
```

默认命令只盘点。`--upload` 会按 4 路并发上传，已存在且大小、SHA-256 元数据一致的对象会跳过，可在中断后重跑。已匹配对象键为 `audio/2026/<文章 ID>.mp3`；未匹配对象键为 `audio/2026/unmatched/<期号>/<相对路径摘要>.mp3`。上传后查看 R2 桶对象数量、大小，并请求一篇文章的 GET、HEAD、Range 音频链接。

## 发布 Worker 与 Web

使用 Cloudflare 的最小权限部署凭证设置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，或用 Wrangler 官方 OAuth 登录。部署凭证只放在本地环境变量中。先发布音频、插图和 API，再把 Web Worker 地址写入 `app/.env`：

使用 OAuth 时，先运行 `npx wrangler login` 并在 Cloudflare 完成授权；D1 操作需要 `d1:write`。`cloudflare/.env.local` 中若仍有过期的 `CLOUDFLARE_API_TOKEN`，它会覆盖有效的 OAuth 登录，需移除失效项。D1 迁移脚本优先使用 `CLOUDFLARE_D1_API_TOKEN`，未配置时使用 OAuth，并忽略 Worker 发布用的通用 token；失效的 D1 专用 token 也需移除。保留 `CLOUDFLARE_ACCOUNT_ID`，确保操作目标账户正确。

```powershell
npm run cloudflare:deploy:audio
npm run cloudflare:deploy:images
```

```dotenv
EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN=https://waikan-web.<你的子域>.workers.dev
EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN=https://waikan-web.<你的子域>.workers.dev/v1/editorial/images
EXPO_PUBLIC_API_BASE_URL=https://waikan-web.<你的子域>.workers.dev
```

Web 版在打开文章时从 Cloudflare 静态资源读取该期正文，原生端继续使用安装包内的正文。导出的入口 JavaScript 预压缩为 gzip，由轻量 Worker 按原 URL 提供，避免触及免费套餐的单文件 25 MiB 上限。Web 构建时把 `EXPO_PUBLIC_API_BASE_URL` 设为 Web Worker 自身地址；本地开发仍可用 `localhost`。重新导出、复制期号正文并发布 Web：

```powershell
Push-Location app
$env:EXPO_PUBLIC_API_BASE_URL = 'https://waikan-web.<你的子域>.workers.dev'
& ..\node_modules\.bin\expo.cmd export --platform web --output-dir dist --clear
Pop-Location
npm run cloudflare:prepare:web
npm run cloudflare:deploy:web
```

正式 Web 配置 `cloudflare/web/wrangler.jsonc` 和切换时使用的 `wrangler.cutover.jsonc` 均把 `/v1/*` 与 `/computer-upload*` 经 `API_SERVICE` Service Binding 转到 `waikan-api`；`/v1/editorial/audio/*` 经 `AUDIO_SERVICE` 直达 R2 音频 Worker，保留 Range 请求头。图片仍由 API 的 `IMAGE_SERVICE` 转到插图 Worker。TestFlight 生产构建使用同一 Web origin 获取 API、图片和录音。不要在未同步 D1 和 Neon 数据的情况下恢复曾经转到 Render 的配置，否则可能形成双写或丢失新数据。

### 黑洞英语专用域名

正式入口配置为 `https://blackholeenglish.com`，Custom Domain 绑定同一个 `waikan-web`，API、录音和图片继续使用上述 Service Bindings 与既有数据。两个 Web Wrangler 配置显式设置 `workers_dev=true`，保留旧安装包的入口；不要因为添加 Custom Domain 而停用 `workers.dev`。旧网站 GET/HEAD 链接跳转到新域名并保留路径和查询；旧域名的 `/v1/*` 和电脑上传接口继续转发，旧 App 的身份令牌不会因域名跳转而跨域发送。

静态资源配置必须保留 `run_worker_first=true`，让根页面和其他网站路径先执行域名跳转；否则静态资源会先返回旧 origin 下的页面，新客户端访问专用域名 API 时会被来源校验拒绝。

Name.com 的域名服务器需要仅保留 `eric.ns.cloudflare.com` 和 `shubhi.ns.cloudflare.com`。注册商设置保存、Cloudflare Zone 激活及 HTTPS 证书生效之后，才能验证新入口并发布使用它的客户端；接入状态和验证证据见 [Build 35 连接排查](../docs/2026-09-26-build35-connectivity.md)。

生产 Web 导出与 iOS 构建需要保持三个公开变量一致：`EXPO_PUBLIC_API_BASE_URL=https://blackholeenglish.com`、`EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN=https://blackholeenglish.com`、`EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN=https://blackholeenglish.com/v1/editorial/images`。本地开发仍可使用 localhost，不能从本地开发地址生成生产静态包。

旧安装包若仍直连 Render，必须让原 Render 地址只转发到 Cloudflare，避免 Neon 与 D1 各自写入。`server/dist/compat-proxy-entry.js` 是不连接 Neon、不启动旧任务 worker 的临时转发入口；设置 `CLOUDFLARE_API_ORIGIN=https://waikan-api.<你的子域>.workers.dev` 后运行 `npm run start:compat --workspace=@context-reader/server`。`render.yaml` 和线上 Render 服务均已改为这个启动命令并移除启动前的数据库迁移；线上环境也已删除 Neon 与 EvoLink 密钥。旧客户端全部更新后即可停用这个兼容服务。

现有 API 发布 `EDITORIAL_AUDIO_PUBLIC_ORIGIN=https://waikan-audio.<你的子域>.workers.dev` 后，会把新版清单中的 2026 音频请求临时重定向到 Cloudflare。旧版客户端仍可能直连独立媒体 Worker；新构建经 Web Worker 的公开同源路径获取媒体。`EXPO_PUBLIC_` 变量会进入客户端产物，只能填写公开地址，绝不能放数据库、R2 或 AI 密钥。

### 香港中转 cn.blackholeenglish.com 与客户端 IP

`cn.blackholeenglish.com` 解析到香港腾讯云轻量服务器（43.161.240.244），由 Caddy 反向代理到 `https://blackholeenglish.com`，Host 改写为正式域名。经中转的请求在 Cloudflare 看来都来自中转出口 IP，因此 API 的限流和电脑上传尝试锁定统一由 `cloudflare/api/src/core/client-ip.ts` 的 `getClientIp` 取得客户端 IP：

- 只有同时满足以下条件时，才采用 `X-Relay-Client-IP`：已配置 Worker secret `RELAY_SHARED_SECRET`；`CF-Connecting-IP` 属于 `RELAY_IPS`（`wrangler.jsonc` 的 `vars`，英文逗号分隔）；`X-Relay-Secret` 与 secret 一致（摘要后定长比较）；`X-Relay-Client-IP` 是单个合法 IPv4／IPv6 地址。
- 任何一项不满足时仍使用 `CF-Connecting-IP`，与原行为相同。未配置 secret 时完全忽略 `X-Relay-*` 请求头。
- Caddy 先用 `request_header -X-Relay-*` 删除客户端自带的同名请求头，再设置 `X-Relay-Client-IP {remote_host}`，并从仅 root 与 caddy 可读的 `/etc/caddy/relay-secret.caddy` 导入 `header_up X-Relay-Secret "<secret>"`。服务器默认 `caddy.service` 以 `caddy run --environ` 启动，会把环境变量打印到日志，所以不要把 secret 放进 Caddy 的环境变量。

secret 只放在 Worker secret 与中转服务器的文件中，不能写入 `vars`、仓库或客户端变量：

```bash
openssl rand -hex 32   # 生成后仅在本机临时保存
npx wrangler secret put RELAY_SHARED_SECRET --config cloudflare/api/wrangler.jsonc
```

先在中转服务器写入 secret 文件并 `caddy validate`，再发布 API（`npm run cloudflare:deploy:api`），最后 `systemctl reload caddy`。中转出口 IP 变化时须同步更新 `RELAY_IPS` 并重新发布 API；更换 secret 时先更新 Worker secret，再更新中转文件并 reload。两步之间经中转的用户会暂时共用中转 IP 的限流额度。

原生 App 不发送 `Origin`，可直接把 `EXPO_PUBLIC_API_BASE_URL` 指向中转域名。浏览器从 `https://cn.blackholeenglish.com` 页面发起的 API 请求会带 `Origin: https://cn.blackholeenglish.com`，被 `waikan-web` 的同源检查拒绝；Web 版继续使用 `https://blackholeenglish.com`。

## API 与 D1 迁移

`cloudflare/api/wrangler.jsonc` 定义 API 的 D1、R2、AI、Images、Durable Object、Queue 与 Cron 绑定。业务入口当前为 `API_STAGE_OPEN=true`。生产快照放在被 Git 忽略的 `.migration/` 中，可能包含用户数据，不得提交或复制到客户端。

`npm run cloudflare:export:neon` 从 `app/.env` 读取 Neon 连接，只读导出 25 张业务表；为旧词库在快照中重建缺失的 FSRS 状态。D1 迁移凭证应只保存在本地 `cloudflare/.env.local`，不要与客户端变量混用。获得限时 D1 写入凭证后依次执行：

可以先运行 `npm run cloudflare:rehearse:d1 -- .migration/<快照目录>`，在内存 SQLite 中逐表核对 SQL、行摘要与外键。现有 985 行快照已通过此演练，未写入远端 D1。

```powershell
npm run cloudflare:d1:migrate:api
npm run cloudflare:import:d1 -- .migration/<快照目录> --apply
```

日常 API 更新若新增 D1 迁移，先执行 `npm run cloudflare:d1:migrate:api`，再执行 `npm run cloudflare:deploy:api`。`0003_import_media.sql` 只加两列，保留旧文章与导入记录；新导入的公开网页媒体保存为 HTTPS 地址，阅读时从原站加载，不占用临时导入 R2 桶。

第二条命令按行数、逐行摘要、外键及 D1 支持的 `PRAGMA quick_check` 核对 D1 导入。已导入 03:40 UTC 的快照，并用临时预览密钥在实际 Worker 上核验匿名身份创建、仪表板和词库读取；合成身份已清理，预览密钥已删除。正式切换前暂停 Render 写入，04:18 UTC 的最终快照与已导入快照完全一致，D1 又通过行摘要、外键与 `quick_check` 核验。之后业务写入只应进入 D1；不要直接恢复旧 Fastify/Neon 服务。

暂停旧写入后，运行 `npm run cloudflare:compare:neon -- .migration/<已导入快照> .migration/<最终快照>`。退出码 0 表示 25 张表行数和内容摘要均相同，可再次运行导入命令核验 D1；退出码 1 则必须先在空 D1 库导入最终快照，不能继续切换。

## 完整迁移的后续工作

原 Fastify 服务依赖 25 张 PostgreSQL 表、Neon 租约任务队列、`sharp`、PDF/HEIC 解析和 EvoLink 调用。D1 是 SQLite，Worker 已重写练习创建、生成、首次答题、URL/文件导入处理和电脑上传；Queue 的导入处理和练习生成通过本地 D1 隔离核验。公开的外刊目录当前为空，Worker 已按现有数据返回空目录；旧版 EPUB 插图路径通过 Service Binding 读取 `waikan-images`。导入临时 R2 资产设置了 256 MiB 应用级上限，为账户共享的免费 10 GB-month 留空间。经用户确认，URL 导入改为使用 [Cloudflare 出站隔离](https://developers.cloudflare.com/workers/reference/security-model/)；应用仍逐跳校验 URL、只接受公开域名、限制响应大小和耗时，但不再声称与原来的 DNS 校验及连接 IP 固定等价。正式切换后仍需持续观察真实流量、任务队列、邮件和免费额度。

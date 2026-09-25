# Cloudflare 免费套餐部署

本目录部署四个独立项目：`waikan-audio`（私有 R2 音频接口）、`waikan-images`（外刊插图静态资源）、`waikan-web`（Expo Web 静态页面）和 `waikan-api`（业务 API）。音频 R2 桶为 `waikan-2026-audio`，Standard 存储类，不启用公共访问。2026 年全部 2,725 个 MP3 共 8,383,477,481 字节；其中 2,674 个文章可播放，51 个未匹配文件只归档。

`waikan-api` 已发布在独立的 `workers.dev` 地址，绑定 SQLite Durable Object `CpuBoundary`、D1、私有 R2、Images、Workers AI、插图 Worker、Queue 和每分钟 Cron，并配置 EvoLink 和 Resend Worker secrets。Resend 密钥仅有 `danceclip.org` 的发信权限，密码重置发件地址为 `no-reply@danceclip.org`；旧密钥已删除。D1 `waikan-core` 已应用 `0001`、`0002` 两份迁移，导入 Neon 数据（25 张表、985 行）。2026-09-25 04:18 UTC 暂停 Render 后导出的最终快照与已导入快照逐表摘要一致，D1 重新核对通过。`API_STAGE_OPEN=true`，`/health/live` 和 `/health/ready` 均返回 200。正式 `waikan-web` 已通过 Service Binding 把同源 API 转发到 Cloudflare。

## 免费额度边界

- R2 Standard 每个 Cloudflare **账户**每月包含 10 GB-month 存储、100 万次 Class A 操作和 1000 万次 Class B 操作；所有桶共享额度。2026-09-25 仪表盘显示全账户总存储 8.41 GB（音频桶 8.38 GB，其他项目图片桶约 26.83 MB，临时导入桶 0 B），Class A 约 2.85k 次、Class B 约 8.15k 次。`waikan-imports-temp` 已设置全桶八天后删除规则；仍需检查月平均用量。静态插图约 1.34 GB、17,164 文件，独立静态资源项目不占 R2 音频空间。
- [Workers Free](https://developers.cloudflare.com/workers/platform/limits/) 每日 100,000 次请求，每次 HTTP 请求只有 10 ms CPU。邮箱 scrypt 和 4,510 词长文规范化已在目标免费账户进行合成核验，Durable Object 日志显示约 239–253 ms CPU 且执行成功。首次答题的同词 FSRS 历史重放也已搬入 Durable Object，本地 D1 验证了原子提交和提示词失败规则；并发竞态及真实流量仍须核验。[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) 全账户每日 500 万行读取、10 万行写入；[Queues Free](https://developers.cloudflare.com/queues/platform/pricing/) 每日 10,000 次操作。
- 不启用 Workers Paid、Containers 或 Infrequent Access。[R2 免费额度](https://developers.cloudflare.com/r2/pricing/)用完后可能产生按量费用；预算提醒不能代替存储硬上限。上传临时文件前必须确保整个账户的 R2 用量仍留在额度内。

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

使用 Cloudflare 的最小权限部署凭证设置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，或用 Wrangler 官方 OAuth 登录。部署凭证只放在本地环境变量中。先发布音频和插图，再把返回的 `workers.dev` origin 写入 `app/.env`：

```powershell
npm run cloudflare:deploy:audio
npm run cloudflare:deploy:images
```

```dotenv
EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN=https://waikan-audio.<你的子域>.workers.dev
EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN=https://waikan-images.<你的子域>.workers.dev
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

正式 Web 配置 `cloudflare/web/wrangler.jsonc` 和切换时使用的 `wrangler.cutover.jsonc` 均把 `/v1/*` 与 `/computer-upload*` 经 `API_SERVICE` Service Binding 转到 `waikan-api`。不要在未同步 D1 和 Neon 数据的情况下恢复曾经转到 Render 的配置，否则可能形成双写或丢失新数据。

旧安装包若仍直连 Render，必须让原 Render 地址只转发到 Cloudflare，避免 Neon 与 D1 各自写入。`server/dist/compat-proxy-entry.js` 是不连接 Neon、不启动旧任务 worker 的临时转发入口；设置 `CLOUDFLARE_API_ORIGIN=https://waikan-api.<你的子域>.workers.dev` 后运行 `npm run start:compat --workspace=@context-reader/server`。`render.yaml` 和线上 Render 服务均已改为这个启动命令并移除启动前的数据库迁移；线上环境也已删除 Neon 与 EvoLink 密钥。旧客户端全部更新后即可停用这个兼容服务。

现有 API 发布 `EDITORIAL_AUDIO_PUBLIC_ORIGIN=https://waikan-audio.<你的子域>.workers.dev` 后，会把新版清单中的 2026 音频请求临时重定向到 Cloudflare。客户端设置媒体 origin 后将直接访问 Cloudflare。`EXPO_PUBLIC_` 变量会进入客户端产物，只能填写公开地址，绝不能放数据库、R2 或 AI 密钥。

## API 与 D1 迁移

`cloudflare/api/wrangler.jsonc` 定义 API 的 D1、R2、AI、Images、Durable Object、Queue 与 Cron 绑定。业务入口当前为 `API_STAGE_OPEN=true`。生产快照放在被 Git 忽略的 `.migration/` 中，可能包含用户数据，不得提交或复制到客户端。

`npm run cloudflare:export:neon` 从 `app/.env` 读取 Neon 连接，只读导出 25 张业务表；为旧词库在快照中重建缺失的 FSRS 状态。D1 迁移凭证应只保存在本地 `cloudflare/.env.local`，不要与客户端变量混用。获得限时 D1 写入凭证后依次执行：

可以先运行 `npm run cloudflare:rehearse:d1 -- .migration/<快照目录>`，在内存 SQLite 中逐表核对 SQL、行摘要与外键。现有 985 行快照已通过此演练，未写入远端 D1。

```powershell
npm run cloudflare:d1:migrate:api
npm run cloudflare:import:d1 -- .migration/<快照目录> --apply
```

第二条命令按行数、逐行摘要、外键及 D1 支持的 `PRAGMA quick_check` 核对 D1 导入。已导入 03:40 UTC 的快照，并用临时预览密钥在实际 Worker 上核验匿名身份创建、仪表板和词库读取；合成身份已清理，预览密钥已删除。正式切换前暂停 Render 写入，04:18 UTC 的最终快照与已导入快照完全一致，D1 又通过行摘要、外键与 `quick_check` 核验。之后业务写入只应进入 D1；不要直接恢复旧 Fastify/Neon 服务。

暂停旧写入后，运行 `npm run cloudflare:compare:neon -- .migration/<已导入快照> .migration/<最终快照>`。退出码 0 表示 25 张表行数和内容摘要均相同，可再次运行导入命令核验 D1；退出码 1 则必须先在空 D1 库导入最终快照，不能继续切换。

## 完整迁移的后续工作

原 Fastify 服务依赖 25 张 PostgreSQL 表、Neon 租约任务队列、`sharp`、PDF/HEIC 解析和 EvoLink 调用。D1 是 SQLite，Worker 已重写练习创建、生成、首次答题、URL/文件导入处理和电脑上传；Queue 的导入处理和练习生成通过本地 D1 隔离核验。公开的外刊目录当前为空，Worker 已按现有数据返回空目录；旧版 EPUB 插图路径通过 Service Binding 读取 `waikan-images`。导入临时 R2 资产设置了 256 MiB 应用级上限，为账户共享的免费 10 GB-month 留空间。经用户确认，URL 导入改为使用 [Cloudflare 出站隔离](https://developers.cloudflare.com/workers/reference/security-model/)；应用仍逐跳校验 URL、只接受公开域名、限制响应大小和耗时，但不再声称与原来的 DNS 校验及连接 IP 固定等价。正式切换后仍需持续观察真实流量、任务队列、邮件和免费额度。

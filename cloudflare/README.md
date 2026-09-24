# Cloudflare 免费套餐部署

本目录部署三个独立项目：`waikan-audio`（私有 R2 音频接口）、`waikan-images`（外刊插图静态资源）和 `waikan-web`（Expo Web 静态页面）。R2 桶为 `waikan-2026-audio`，Standard 存储类，不启用公共访问。2026 年全部 2,725 个 MP3 共 8,383,477,481 字节；其中 2,674 个文章可播放，51 个未匹配文件只归档。

当前业务 API、后台任务和 PostgreSQL 数据仍在 Render/Neon。Web Worker 把同源 `/v1/*` 请求转发到现有 Render API，以免浏览器受到旧服务 CORS 配置阻拦；这不等于迁移了业务计算或数据库，不能关闭旧服务。移动端安装包的公开 URL 在构建时写入，旧版需要新版本或旧 API 转发。

## 免费额度边界

- R2 Standard 每个 Cloudflare **账户**每月包含 10 GB-month 存储、100 万次 Class A 操作和 1000 万次 Class B 操作；所有桶共享额度。上传前在 R2 控制台查看其他桶和当期用量。当前源文件加原有约 26.83 MB 小于 10 GB；未来新增音频或其他桶会占用剩余额度。
- Workers Free 每日请求量和每次 CPU 时间有限。静态插图约 1.34 GB、17,164 文件，独立静态资源项目不占 R2 音频空间。
- 不启用 Workers Paid、Containers 或 Infrequent Access。免费额度不是硬性停机上限，应在 Cloudflare Billing 配置预算提醒并定期核对用量。

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

现有 API 发布 `EDITORIAL_AUDIO_PUBLIC_ORIGIN=https://waikan-audio.<你的子域>.workers.dev` 后，会把新版清单中的 2026 音频请求临时重定向到 Cloudflare。客户端设置媒体 origin 后将直接访问 Cloudflare。`EXPO_PUBLIC_` 变量会进入客户端产物，只能填写公开地址，绝不能放数据库、R2 或 AI 密钥。

## 完整迁移的后续工作

现有 Fastify 服务依赖 25 张 PostgreSQL 表、Neon 租约任务队列、`sharp`、PDF/HEIC 解析和 EvoLink 调用。D1 是 SQLite，不能直接导入 PostgreSQL schema；临时上传的二进制也需从数据库改存 R2。必须完成路由、持久化、任务处理和数据迁移，确认客户端切换及历史数据保留，再下线 Render/Neon。上述功能未迁移前，`waikan-web` 页面可以访问，但练习、登录、导入等仍依赖原业务 API。

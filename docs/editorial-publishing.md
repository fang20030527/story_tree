# 每日外刊发布

精选外刊由服务端内容文件提供。客户端首次接入此接口需要发布一个新版本；之后增加文章只需部署服务端，读者重新打开外刊页或下拉刷新即可看到。原来打包在客户端的文章继续保留。

首次构建 TestFlight / App Store 版本时，确保构建环境中的 `EXPO_PUBLIC_API_BASE_URL` 是实际运行中 API 的 HTTPS 域名；`app/.env` 中的局域网地址只用于开发。后续只更新文章内容文件时，无需再次构建客户端。

## 发布步骤

1. 在 `server/content/editorial/articles/` 新增一个 UTF-8 JSON 文件。文件名必须与 `id` 一致，例如 `remote-2026-09-24-01.json`。
2. 如有封面、插图或录音，将文件放到 `server/content/editorial/assets/`。素材名只允许小写英文字母、数字、点、下划线和连字符；图片支持 WebP、PNG、JPG，录音支持 MP3。文章中用 `/v1/editorial/assets/<文件名>` 引用。也可以用公开的 HTTPS 地址。
3. 先运行 `npm run editorial:validate --workspace=@context-reader/server`。校验失败时不要部署。
4. 将服务端改动提交并部署到 Render 当前追踪的分支（此仓库 `render.yaml` 中为 `codex/cloud-core-backend`）。客户端请求新的目录和文章正文，不需要再次构建或提交 App Store。

新文章按 `publishedAt` 日期排序，同一天按 `id` 排序，最新一篇成为「今日精选」；其余文章进入刊物/日期列表。`status` 为 `draft` 的文件不会出现在接口中。修改已发布的文章后重新部署即可更新；如修改图片或录音，建议换一个新文件名，避免设备继续使用旧缓存。

「精选外刊」会自动突出最新一篇服务端文章；其余文章仍留在原有刊物/日期列表中。新增更晚的文章并部署后，精选会自动切换，不必修改配置或更新客户端。

## 文章文件示例

以下示例保持为草稿；复制后替换全部示例内容，再将 `status` 改为 `published`。

```json
{
  "id": "remote-2026-09-24-01",
  "status": "draft",
  "titleZh": "文章中文标题",
  "titleEn": "Article title",
  "summaryZh": "用中文概述文章的主要内容。",
  "keyPointsZh": ["第一个阅读要点", "第二个阅读要点"],
  "source": "刊物名称",
  "sourceUrl": "https://example.com/original-article",
  "issueDate": "2026-09-24",
  "category": "科技",
  "level": "雅思 6.5",
  "image": "/v1/editorial/assets/remote-2026-09-24-01.webp",
  "publishedAt": "2026-09-24",
  "paragraphs": [
    "The first paragraph of the article goes here.",
    "The second paragraph of the article goes here."
  ]
}
```

`wordCount` 和 `minutes` 可以不填，服务端会根据正文自动计算。`audioUrl` 可填公开 HTTPS MP3 地址或本站素材路径；没有录音时使用客户端已有的朗读功能。插图可以使用 `figures`，或用 `bodyBlocks` 交错排列文字和图片。使用 `bodyBlocks` 时，其全部文字块必须与 `paragraphs` 逐段一致。文件最大 512 KiB，单个素材最大 50 MiB。

## 接口

- `GET /v1/editorial/articles`：只返回已发布文章的目录信息，避免首页下载全部正文。
- `GET /v1/editorial/articles/:id`：返回正文和阅读需要的详细信息。
- `GET /v1/editorial/assets/:name`：提供已发布文章引用的图片和录音，录音支持范围请求。

客户端会保留上次成功取得的目录。暂时离线时，旧目录与原有的内置文章仍可浏览；新文章正文需要联网获取。

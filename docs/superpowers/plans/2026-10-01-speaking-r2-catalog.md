# 口语固定资源迁入 R2 实施计划

> **执行方式：** 沿用 writing-plans / executing-plans 工作流，服务端目录与客户端接入分工完成，主代理负责真实凭证配置、迁移与最终审查。用户已授权配置 R2、迁移三部有字幕电影，并明确作为所有用户可见的固定资源。沿用现有 `codex/` 分支，保留工作区修改，不提交或切换工作区。

**目标：** 口语「素材」页提供《阿甘正传》《泰坦尼克号》和本地目录标识为 The Odyssey 的完整视频与已有字幕，媒体由私有 R2 提供。

**架构：** 保留原创内置素材；新增服务端 `server/content/speaking/cloud-catalog.json` 发布清单，内容为 `{materials:[{material:SpeakingMaterialDto,media:{storageKey,byteSize,contentType,sha256}}]}`。共享目录与详情为公开只读 API，播放使用十分钟 R2 预签名地址；收藏、笔记、字幕覆盖、录音与历史仍按现有账号或设备隔离。个人上传与共享影片的存储对象互不混用。

**技术：** Fastify、共享 Zod 契约、AWS SDK v3 multipart、FFprobe、Expo SDK 57。

## 全局约束

- 只读取 `D:\qBittorrent\下载` 的三个已验证带字幕影片；不修改、移动、删除原文件，不处理无字幕《星际穿越》，不调用 AI 或支付。
- 使用已有有效 R2 对象读写凭证和私有 `waikan-2026-audio` 桶；固定影片对象位于 `speaking/platform/`，不改变现有 `audio/` 对象。凭证只写入忽略提交的 `app/.env`。
- CORS 只补充实际 Web 来源，保留已有规则；桶不开放公开访问。三片共 3,746,314,922 字节，新增费用已向用户说明。
- 影片按 SHA-256 使用稳定键；先上传并核对大小和头／中／尾 Range 字节，再原子发布目录。断点重跑不复制已核验完整对象。
- 目录、详情响应不包含对象键和凭证。预签名 URL 不写日志。清理只删本次创建的验证对象，不删已发布影片。
- 无数据库结构变更；固定素材不计入任何个人文件库或上传配额。共享字幕校正仍保存为个人覆盖。

## 任务 1：共享目录与播放接口

文件：`server/src/modules/speaking/catalog.ts`、`routes.ts`、共享契约及相应测试。

- [x] 合并原创目录与可选发布清单，校验影片 `sourceKind='platform'`、`assetId=null`、时间范围和安全对象键。
- [x] 新增公开 `GET /v1/speaking/catalog`（`{materials:SpeakingMaterialSummary[]}`）、`GET /v1/speaking/catalog/:id`（完整 DTO）、`GET /v1/speaking/catalog/:id/playback`（现有 `SpeakingPlaybackDto`）。不存在资源返回 404，本地示范音不假装有 R2 视频。
- [x] 已登录 `/library` 同样包含发布资源，扩大原先最多三份平台素材的限制，使 50 份个人文件加六份固定素材合法。
- [x] 验证目录不泄露 `storageKey`，全局原字幕不会被个人校正修改，播放响应 `Cache-Control: no-store`。

示例契约：

```ts
export const SpeakingCatalogDtoSchema = z.object({
  materials: z.array(SpeakingMaterialSummarySchema).max(100),
}).strict();
```

## 任务 2：客户端固定资源入口

文件：`app/src/api/speaking.ts`、`app/src/features/speaking/useSpeakingLibrary.ts`、`cloudSync.ts`、`ShadowingScreen.tsx`、`catalog.ts` 及相应测试。

- [x] 所有用户读取公开共享摘要；以 ID 合并内置、共享、个人文件，避免新电影漏入素材页或显示在「文件」。
- [x] 进入详情时才获取完整字幕；登录用户使用个人覆盖，来宾使用本地状态。分类加入「电影对白」。
- [x] `origin='platform'` 的远程视频通过 `getSpeakingCatalogPlayback(material.id)` 获取并更新播放链接，个人视频继续使用资产播放接口。
- [x] 缓存仅保留当前一部远程电影的完整字幕，避免长期累计大型字幕写入。
- [x] 保持原设计系统；验证来宾和登录模式均能显示、打开新影片，已有文件与示范音功能继续正常。

## 任务 3：配置、真实迁移与验收

文件：`app/.env`（忽略）、`.local-test-results/speaking/`（忽略脚本与报告）、`server/content/speaking/cloud-catalog.json`、`docs/speaking-backend.md`、`docs/speaking-r2-migration.md`。

- [x] 用小型专用对象验证 R2 写入、读取、签名播放和 CORS，并清理该对象。
- [x] 安全复制四项服务端 R2 配置，持久化播放签名密钥，切换 `SPEAKING_STORAGE_DRIVER=r2`，重启本地 API。
- [x] 流式 multipart 上传三片及 SRT，验证完整大小、字幕共 5,046 句、九段 Range 与原文件相等，再发布固定资源。
- [x] 执行相关服务端／客户端／契约测试、全工作区 typecheck 与 lint、服务端构建、Web 导出和客户端密钥检查。
- [x] 验证实际共享目录、详情、签名播放与私有桶拒绝未签名读取；记录本地 Fastify 已接入和现有 Cloudflare 生产 API 的部署边界。

## 完成记录

详见 [R2 迁移报告](../../speaking-r2-migration.md)。真实迁移三部电影、三份 SRT 和一份目录快照成功；全桶 2,732 个对象、约 12.13 GB。相关服务端 73 项、契约 50 项、完整客户端 414 项通过，真实浏览器按句定位与持续播放通过。未切换或部署既有 Cloudflare 生产 API。

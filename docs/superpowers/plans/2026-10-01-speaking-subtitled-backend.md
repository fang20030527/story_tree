# 已有字幕的口语后端实施计划

> **执行方式：** 使用 writing-plans / executing-plans 工作流按模块实施、验证，存储与客户端接入使用分工代理。用户已确认先做带字幕电影；沿用当前 `codex/` 分支与最新前端，保留已有未提交修改，不提交或切换工作区。

**目标：** 把已有字幕的电影、音频和 YouTube 素材接入账号资源库，实现字幕校正、私有媒体播放、收藏笔记、录音资产与学习记录保存。

**架构：** Fastify 的 `/v1/speaking` 模块复用安装令牌、幂等请求和 Neon。音视频流式写入媒体存储，Neon 只存资产与字幕元数据。本地开发使用独立文件目录，正式云存储使用私有 R2。已有 SRT / VTT 不调用 AI。

**技术：** TypeScript、共享 Zod 契约、Drizzle、PostgreSQL、AWS SDK v3、FFprobe、Expo SDK 57。

## 全局约束

- 本轮不运行自动字幕、支付交易或 AI 发音评分；无字幕的《星际穿越》只报告缺少外置字幕。
- 用户已授权测试 `D:\qBittorrent\下载`；只读取源文件，不移动、删改或整片读入内存。
- 一次媒体上传最多 3 GiB，账号保留与待上传资产合计默认 10 GiB，字幕最多 512 KiB / 10,000 句。
- 电影对白允许时间重叠，但开始时间必须排序；字幕结束时间不得超过已验证媒体时长。
- 所有 JSON 变更带 `Idempotency-Key`；二进制按资产 ID 与服务端 SHA-256 校验安全重放。
- 个人素材、播放授权、录音、字幕覆盖和学习状态按账号隔离。变更字幕与笔记用版本号防止旧设备覆盖新内容。
- 生产未配置存储时仅禁用媒体上传，原阅读 API 继续运行。私有 R2 凭证只在服务端。
- 数据库测试只用 `app_test_*` Schema；本轮先生成增量迁移，测试通过后显式迁移并启动本地 API。

## 任务 1：契约与数据库

文件：`packages/contracts/src/index.ts`、`packages/contracts/src/speaking.test.ts`、`server/src/db/schema.ts`、`server/drizzle/0011_*.sql`。

接口：`SpeakingCue = {id,start,end,en,zh}`；`SpeakingMaterialDto` 含媒体来源、资产 ID、时长、完整字幕及 `revision`；`SpeakingStateDto` 含收藏、笔记、播放位置、录音及 `revision`；同一练习使用稳定的客户端 session ID。

- [x] 定义严格契约和范围校验，新增 `speaking_assets / speaking_materials / speaking_states / speaking_sessions`。
- [x] 使用 `npm run db:generate --workspace=@context-reader/server` 生成只新增数据结构的迁移。
- [x] 验证未知字段、非法时间、重复句编号、3 GiB 上限与允许对白重叠：

```ts
expect(SpeakingCuesSchema.safeParse([
  {id:'a', start:0, end:2, en:'Hello.', zh:''},
  {id:'b', start:1, end:3, en:'Good morning.', zh:''},
]).success).toBe(true);
```

## 任务 2：媒体存储与私有播放

文件：`server/src/infrastructure/media/`、`server/src/modules/speaking/assets.ts`、`server/src/modules/speaking/playback.ts`、`server/src/config/env.ts`、`app/.env.example`。

接口：`MediaStore` 提供 `putFile / stat / openRead / delete / downloadFile`，R2 另提供预签名读取；`FFmpegMediaProcessor.probe(path,signal)` 返回实际时长与音视频信息。

- [x] 流式上传到临时目录并算 SHA-256，校验实际容器、音轨、字节数、媒体时长，再发布为 ready。
- [x] 并发上传由独占租约保护；上传完成后同内容重传返回同一资产，不同内容重放、外账号、过期上传和超额拒绝。
- [x] 短期播放票据校验后支持 HEAD、Range、后缀范围及 416；日志去掉查询参数，票据和对象键不进入普通素材响应。
- [x] 本地开发与私有 R2 实现接口测试，避免整片缓存内存和任意目录访问。

## 任务 3：字幕、笔记与记录 API

文件：`server/src/modules/speaking/{routes,service,subtitles,catalog}.ts`、`server/src/modules/idempotency/service.ts`、`server/src/app.ts`。

接口：`POST /assets`、`PUT /assets/:id/content`、`POST /materials`、`GET /library`、`PATCH /materials/:id/subtitles`、`POST /materials/:id/subtitles/import`、`GET /PATCH /materials/:id/state`、`PUT /sessions/:clientId`。

- [x] 服务端独立解析 SRT / VTT、去显示标签、保留双语和电影对白重叠，并验证媒体范围。
- [x] 文件与 YouTube ID + 自带字幕可入库；三个原创内置素材保持账号独立的字幕覆盖。
- [x] 旧版本更新返回 `STATE_CONFLICT`，笔记和收藏只能引用当前可见素材的句子。
- [x] 同一个练习 ID 的定时保存保留累计时间较大值，防重复记录、旧快照倒退。
- [x] 隔离数据库集成测试覆盖权限、幂等、冲突与真实播放范围。

## 任务 4：接入真实客户端

文件：`app/src/api/speaking.ts`、`app/src/features/speaking/`。

- [x] 已登录账号显示实际云资源；来宾保留已有本地数据并显示登录后可使用云资源。
- [x] 带字幕文件流式上传，成功后可校正、重新读取、取短期播放 URL 并跟读；请求失败显示重试。
- [x] 保留已有设备数据，账号切换隔离；云收藏、笔记、字幕和历史不伪装保存成功。
- [x] 字幕编辑分页，避免整部电影挂载数千个文本输入框；保持原设计系统。
- [x] 核对 Expo 57 官方文件上传文档，避免 native fetch 把整部电影转成 ArrayBuffer。

## 任务 5：真实电影与回归

文件：`server/scripts/speaking-movie-smoke.ts`、`docs/speaking-movie-test.md`。

- [x] 显式 opt-in 本地冒烟：安全 Schema + 临时媒体目录，逐部测试《阿甘正传》《泰坦尼克号》及目录标识为 The Odyssey 的完整媒体上传、全量字幕、字幕校正、收藏笔记和 session 保存。
- [x] 比较 HTTP 范围返回与源文件同位置字节，检查头／中／尾范围与外账号拒绝，不改源文件、不调用模型。
- [x] 按工作区分阶段完成 TypeScript、Test、Lint 全部检查，服务端构建、客户端 Web 导出与密钥检查通过。
- [x] 记录实测时长、字幕数量、处理重叠与发现的问题；写清 R2 真实联调与原生设备播放的验证边界。

## 完成记录

2026-10-01 完成全部实施任务。服务端 60 个文件／351 项测试、客户端 81 个套件／406 项测试、契约 48 项、小程序 9 项均通过；TypeScript、Lint（0 错误，24 条原有前端警告）、服务端构建、39 条 Web 路由导出与 827 个客户端文件密钥检查通过。字幕版本冲突后重试和存储清理故障分别补回归验证。

真实电影共流式上传约 3.49 GiB，导入 5,046 句字幕；9 段播放数据与源文件一致。测试副本与隔离 Schema 已清理。现有开发数据库显式迁移成功，API 3000 和 Web 8081 已启动，本机 FFprobe 路径已配置。没有真实 R2 上传或收费 AI 调用。

本轮浏览器控制连接超时，新云端链路没有完成浏览器手工验收；R2 实际凭证联调、原生设备整片播放、自动字幕、真实支付与 YouTube 客户端嵌入仍按当前范围保留。详见 `docs/speaking-backend.md` 与 `docs/speaking-movie-test.md`。

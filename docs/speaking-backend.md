# 已有字幕的口语后端

2026-10-01 接入已有字幕的音视频。当前客户端使用真实 `/v1/speaking` API 上传文件、读取素材、校正字幕、同步收藏笔记、保存跟读录音和练习记录。已有设备数据继续保留，未登录仍可使用本地文件。

本文件主要说明 Fastify 路径。正式 Web 随后接入 Cloudflare／D1，采用 R2 直传和新增上传确认接口，继续保留原有生产账号与阅读数据。部署及验证见 [阅读与口语 Web 发布报告](2026-10-01-speaking-web-release.md) 与 [Cloudflare 部署说明](../cloudflare/README.md)。

## 启动与迁移

环境变量继续只放在忽略提交的 `app/.env`。新增变量说明在 `app/.env.example`，不要给存储密钥添加 `EXPO_PUBLIC_` 前缀。

```powershell
npm run db:migrate --workspace=@context-reader/server
npm run dev
npm run dev:app
```

API 启动不会执行迁移。本次新增迁移为 `0011`、`0012`、`0013`，只增加口语表、上传租约、清理队列和练习进度时间；已有阅读数据和迁移不变。

本轮已在现有本地开发配置上显式执行迁移并启动 API，`/health/ready` 返回 200，Web 来源的 CORS 预检返回 204。前端可通过 `http://127.0.0.1:8081` 打开。本机 FFprobe／FFmpeg 路径与开发浏览器来源已写入忽略提交的 `app/.env`；真实电影测试的临时素材不会出现在正式账号文件库中。

上传校验需要可运行的 FFprobe。安装 FFmpeg 后，将服务端变量 `FFPROBE_PATH` 设为 `ffprobe.exe` 的绝对路径，或让 `ffprobe` 位于 PATH。`FFMPEG_PATH` 用于后续音轨处理，当前字幕导入不转码、不调用 AI。音视频上限默认 3 GiB，每个账号已保存与未过期上传合计默认 10 GiB，单次上传超时默认 20 分钟。

开发默认 `SPEAKING_STORAGE_DRIVER=local`，媒体存放在服务端工作目录下的 `.local-media/speaking`，不放入数据库。生产未指定存储方式时，默认禁用媒体存储；阅读 API 仍可启动。

## 私有 R2

2026-10-01 后续工作已找到并接入项目现有有效 R2 凭证，本机 Fastify 现使用真实 R2，私有桶 CORS 与实际读写已验证。用户明确三部电影为口语固定资源，新增公开目录／原字幕／短期签名播放接口；个人记录仍隔离。实际迁移进度与部署边界见 [R2 固定资源迁移报告](speaking-r2-migration.md)。以下为通用配置说明，最后一节的「没有真实 R2 联调」描述的是此前本地电影测试轮次。

将 `SPEAKING_STORAGE_DRIVER` 设为 `r2`，并配置服务端的 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET_NAME`。桶保持私有，凭证只授予需要的桶读写权限。Web 播放需要在桶 CORS 中允许实际客户端来源的 GET／HEAD／Range 读取。

客户端流式 PUT 到 API；API 先在临时目录校验实际文件类型、长度、SHA-256、音轨与时长，再通过 AWS SDK multipart 写入 R2。Neon 仅存字幕、元数据、归属和学习记录。客户端向 API 申请有效期 10 分钟的 R2 播放地址，过期后重新申请。部署磁盘、网关请求大小与超时需覆盖配置的上传上限。

本地存储的播放使用签名票据；多实例运行时应配置同一个至少 32 字符的 `SPEAKING_PLAYBACK_SIGNING_KEY`。未配置时每个进程使用临时随机密钥，重启后旧播放链接失效。

上传的每次尝试使用独立对象键和数据库租约。上传失败或录音被替换后进入可重试清理队列，存储短暂不可用时保留对象指针；清理器每 5 分钟重试。已绑定的素材不会按临时上传 TTL 清理。

容量预留只查询数据库，过期未绑定资产不占容量；它不会等待旧对象的存储清理，避免存储故障阻塞下一次上传。

## API 与客户端

个人素材与学习记录接口验证 Bearer 安装令牌；固定素材目录、原字幕和播放申请为公开只读。JSON 变更必须携带 `Idempotency-Key`；二进制重传按资产 ID 和 SHA-256 校验。共享请求与响应来自 `packages/contracts/src/index.ts`。

| 接口 | 用途 |
| --- | --- |
| `GET /v1/speaking/catalog` | 所有用户可见的固定素材摘要，不含内部对象键 |
| `GET /v1/speaking/catalog/:id` | 固定素材完整原字幕；不读取个人覆盖 |
| `GET /v1/speaking/catalog/:id/playback` | 固定影片十分钟私有 R2 播放地址 |
| `GET /v1/speaking/capabilities` | 查询存储与上传上限，自动字幕为未开放 |
| `POST /v1/speaking/assets` | 预留媒体或录音资产与账号容量 |
| `PUT /v1/speaking/assets/:id/content` | 流式上传并验证媒体 |
| `GET /v1/speaking/assets/:id/playback` | 获取私有短期播放地址 |
| `POST /v1/speaking/materials` | 创建文件素材，或保存 YouTube ID 与自带字幕 |
| `GET /v1/speaking/library` | 每页最多 50 份个人素材摘要及相关状态；默认 20 份 |
| `GET /v1/speaking/materials/:id` | 打开素材时读取完整字幕 |
| `PATCH /v1/speaking/materials/:id/subtitles` | 按字幕版本校正时间与文本 |
| `POST /v1/speaking/materials/:id/subtitles/import` | 导入 SRT／VTT 全文 |
| `GET /PATCH /v1/speaking/materials/:id/state` | 收藏、笔记、位置与录音关联 |
| `PUT /v1/speaking/sessions/:clientId` | 累计练习时间及记录，重试不会重复计数 |

字幕最多 512 KiB、10,000 句，开始时间必须有序，允许多人对白时间重叠，结束时间不能超出实际媒体时长。客户端兼容 UTF-8 与 Windows-1252 外挂字幕；字幕编辑每页 20 句。字幕和学习状态分别带版本号，旧设备修改返回冲突，需重新读取后保存。较早的离线练习不会覆盖新的播放位置。

原生客户端使用 Expo SDK 57 `File.upload` 发送文件，Web 发送 File／Blob。字幕详情按需读取，文件库只获取摘要，避免同时加载多部电影的完整字幕。失败保留待重试操作与幂等键，不展示虚假的保存成功。

## 初次本地测试与范围

实测上传《阿甘正传》《泰坦尼克号》及本地目录标识为 The Odyssey 的影片，共约 3.49 GiB、5,046 句字幕。字幕导入、校正、收藏笔记、练习记录、账号隔离及 9 段 HTTP Range 数据校验通过。电影测试只使用隔离数据库与临时本地存储，源文件只读，测试数据已清理。完整步骤见 [电影实测报告](speaking-movie-test.md)。

最终回归：服务端 60 个测试文件、351 项测试；客户端 81 个套件、406 项测试；共享契约 48 项测试；小程序原有 9 项测试均通过。全工作区 TypeScript 与 Lint 通过，前端保留 24 条原有 Lint 警告、0 错误。服务端构建、39 条路由的 Web 导出，以及 827 个客户端文件的密钥检查通过。最后修改的存储清理行为另通过完整口语数据库集成回归。

上述初次测试使用临时本地存储。随后已完成真实 R2 凭证配置、三片固定资源迁移、公开素材接口与 Web 按句定位和持续播放验收，详见 [R2 迁移报告](speaking-r2-migration.md)。原生设备上的整部电影播放仍需验证。YouTube 本次仅实现服务端 ID 与已有字幕的数据接口；客户端嵌入播放器仍标记规划中。自动字幕生成保留先前选择的 Gemini 2.5 Flash-Lite 方案，真实支付、AI 台词讲解、发音评分均不在本轮实施范围。

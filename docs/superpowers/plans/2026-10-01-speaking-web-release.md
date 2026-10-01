# 阅读与口语 Web 正式发布

> 使用 executing-plans 完成本计划。复用当前已隔离的 `codex/import-english-epub-articles` 分支；由共享目录、D1 学习记录、客户端直传三个代理分别完成独立模块，主代理负责资产上传确认、迁移、发布与线上核验。用户已明确授权提交、推送远端 main 和部署 Web，不重复询问发布许可。

**目标：** 将已确认的阅读／口语前端及真实后端代码提交到 main，发布到 `https://blackholeenglish.com`，固定影片和账号学习记录正常工作。

**架构：** 生产继续使用 `waikan-api`／D1，不恢复旧 Neon 写入。口语目录使用现有私有 R2 影片与发布清单；新增 D1 口语表。大文件从客户端以短期签名 PUT 直传 R2，API 核对资产归属、大小、实际格式和客户端解析时长后确认，避免 Cloudflare 请求体上限。原 Fastify 上传流程保留。

**约束：** 不提交 `.env`、迁移快照、验证令牌或签名地址；不修改源电影；不改旧 D1 表和账号；不接真实购买或 AI 自动字幕；使用已有 R2 桶且不公开桶。完整 `npm run check`、Worker 类型检查与真实生产读写核验通过后发布 Web。远端 main 仅快进，不强制推送。

## 任务 1：生产共享目录与签名

文件：`cloudflare/api/src/speaking/catalog.ts`、`signing.ts`、相应测试、`env.ts`、`index.ts`、`wrangler.jsonc`。

- [x] 增加共享目录读取及公开三条路由，返回与 Fastify 相同 DTO。
- [x] 固定目录与按需详情分开保存在私有 R2；摘要只包含合法固定 ID，详情不泄露对象键。
- [x] 导出 `getPlatformCatalog(env)`、`getPlatformMaterial(env,id)` 和 `signSpeakingObject(env,key,method,contentType?,byteSize?)`；签名 GET／PUT 为十分钟、绑定唯一对象键。
- [x] 配置 `SPEAKING_BUCKET` 绑定与四项服务端 R2 secrets；旧 Worker 业务保持原样。
- [x] 共享目录、非法键和签名测试通过。

## 任务 2：D1 口语材料与学习记录

文件：`cloudflare/api/migrations/0005_speaking.sql`、`src/speaking/data.ts`、`routes.ts` 与相应隔离 SQLite 测试。

- [x] 只加资产、材料、状态、练习、幂等和清理表，按用户隔离。
- [x] 实现现有 library／materials／subtitles／state／sessions 接口，复用共享 Zod 和生产认证。
- [x] 版本冲突、个人字幕覆盖、幂等重放、旧练习不覆盖新位置和录音资产归属通过回归。
- [x] 资产行接口统一字段 `id,user_id,status,content_type,byte_size,purpose,storage_key,duration,media_type,expires_at,attached_at,created_at,etag`；根代理负责资产创建／上传／确认／播放。

## 任务 3：Web 大文件直传与客户端

文件：`packages/contracts/src/index.ts`、`app/src/api/speaking.ts`、`mediaStorage.ts` 与相应测试。

- [x] 资产 DTO 增加可选 `directUpload:{url,expiresAt}`，新增共享确认请求 `{duration:number}`。
- [x] 存在直传地址时使用原有文件 Blob／File.upload PUT 到 R2，发送确认请求；不向 R2 发送账号令牌。
- [x] 使用实际媒体读取时长，错误或未知时长不假装上传成功；录音时长可用已知录制值。
- [x] 保留 Fastify 的原上传路径、进度和取消功能；相关测试和类型检查通过。

## 任务 4：资产、安全确认与发布

文件：`cloudflare/api/src/speaking/assets.ts`、相关测试、发布辅助脚本、`cloudflare/README.md`、发布报告。

- [x] 创建资产按用户预留容量与幂等键；PUT 签名仅指向该资产唯一私有对象，确认读取真实大小和文件头，约束时长与格式。
- [x] 发布 R2 摘要／详情并核对三个影片；CORS 增加合法 Web 来源的 PUT／Content-Type，不开启匿名写入。
- [x] 新 D1 迁移本地通过后增量应用生产，安全写入现有凭证为 Worker secrets，先部署 API 并核验健康、目录、播放和隔离账号学习记录。
- [x] 完整检查、Worker 检查、生产变量 Web 导出、静态预压缩和客户端密钥检查通过。
- [x] 提交所有本任务相关改动，快进推送 `HEAD:main`，确认远端提交一致，再部署正式 Web。
- [x] 用实际正式站点验证模式切换、固定素材、字幕和播放，保存截图与发布版本记录。

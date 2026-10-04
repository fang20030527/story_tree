# 双语字幕上线与发布权限恢复

2026-10-05（台北时间）完成 R2 字幕、Cloudflare API 和 Web 发布。正式入口为 [黑洞英语](https://blackholeenglish.com)，跟读页面可直接显示平台预置中英字幕。

## 阻塞原因与处理

- `cloudflare/.env.local` 中的 Worker 发布 token 经 Cloudflare 验证为已过期，D1 专用 token 验证失败。它们会覆盖 Wrangler 的有效登录。已在本机备份配置后移除两项失效值，保留账户和 R2 配置。
- Wrangler 原有 OAuth 登录缺少 D1 权限；用户已在 Cloudflare 官方页面完成新的授权。
- `scripts/apply-cloudflare-d1-migrations.mjs` 现在优先使用 D1 专用 token；没有配置时使用 OAuth，并忽略 Worker 发布用的通用 token。实际运行原有 npm 迁移命令通过，返回没有待执行迁移。
- `app/.env` 指向局域网开发服务。此次 Web 导出显式设置三个公开生产地址，并使用 `EXPO_NO_DOTENV=1`：API、音频均为 `https://blackholeenglish.com`，插图为 `https://blackholeenglish.com/v1/editorial/images`。
- 客户端首次类型检查因旧的 Expo 路由类型缓存缺少 `/username` 报错。执行 `expo customize tsconfig.json` 重新生成类型后通过，无须修改页面代码。

## 线上数据库与备份

实际查询确认 `0001`–`0010` 全部已应用：`0009_usernames.sql` 的执行时间为 2026-10-04 02:36:37，`0010_question_rounds.sql` 为 2026-10-04 21:26:40（均为台北时间）。`practice_questions.round` 已存在，因此本次没有重建业务表。

发布前记录 D1 Time Travel 书签并导出完整 SQL；将备份导入本机内存 SQLite，完整性检查与外键检查均通过。备份包含 98 道题、33 条答案，815,690 字节。

R2 发布前备份了线上 57 份 `material.json` 和一份 `catalog.json`，共 7,008,206 字节；记录对象元数据、ETag 和 SHA-256，并重新读取本地文件核验摘要。发布前后英文、句子编号和时间轴一致。电影、剧集、演讲及播客的原媒体文件保持原有对象。

所有备份和验证记录均放在被 Git 忽略的目录：

```text
.local-test-results/speaking/release-2026-10-05/
  r2-before/                       原始字幕详情与目录
  r2-backup-manifest.json           原始对象元数据及文件摘要
  d1-before.sql                    数据库备份，包含真实用户数据
  d1-backup-verification.json       书签、文件摘要、迁移和完整性结果
  deployment-rollback-versions.json 发布前 API 与 Web 版本
  prepared/                        本次字幕发布包
```

数据库备份和本机凭据备份不得提交到 Git 或复制到客户端产物。Worker 可恢复到记录的旧版本；若需恢复字幕，按备份清单先恢复全部详情，再恢复目录。

## 发布结果

执行顺序为备份与检查 → R2 详情和目录 → API → Web。

| 项目 | 发布结果 |
| --- | --- |
| R2 | 57 份素材、54,248 句字幕全部自带中文；58 个发布对象与本地发布包逐字节一致 |
| API | `0b13e729-18c6-4fa5-87c3-02836d36bc98` |
| Web | `9af09b84-2d56-45a8-8f22-a2a9d67c4acd` |
| API 原版本 | `6dfe5fe5-92e0-4fda-8f26-39fa806ad592` |
| Web 原版本 | `68058c4a-9437-41ff-be4a-bf02435c07d6` |

API 保留既有服务绑定、公开配置和加密 secrets。Web 本次上传 39 个文件，复用 438 个已上传文件。

## 验证

- 客户端 113 套、635 项测试；Cloudflare Worker 23 套、255 项；服务端非数据库测试 51 套、503 项；契约 74 项；小程序 9 项，合计 1,476 项通过。
- 各工作区及 Cloudflare API 类型检查通过；全工作区 lint 无错误，有 24 项既有警告。本次未运行旧 Neon 服务的数据库集成测试，未声称完整 `npm run check` 通过。
- API 和 Web 部署预检通过。Web 导出与静态资源准备通过；扫描全部 479 个客户端文件及 7 项已配置密钥值，未发现泄漏或本机 API 地址。
- API `/health/live`、`/health/ready` 均返回 JSON `status: ok`。正式域名上的 57 份目录详情与本地发布包完全一致，摘要和详情版本一致。
- 正式网页 HTML 引用本次入口脚本，线上解压后的脚本与本地 29,657,465 字节文件完全一致。
- 电影、演讲、剧集和播客各抽查一份播放签名与 1 KiB Range 读取，均返回 206，长度、总大小和 CORS 正确。
- 浏览器打开《老友记》S01E01，直接显示英中台词；1280×720 视频解码完成，`readyState=4`，无媒体错误。

以上是发布、结构、字节一致性及功能检查；译文人工校审范围仍以[双语字幕复核记录](2026-10-03-speaking-bilingual-subtitles.md)为准。

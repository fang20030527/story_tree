# Cloudflare 免费套餐迁移：2026 外刊媒体与 Web

- 日期：2026-09-24
- 状态：用户已选择先使用免费套餐

## 目标与范围

把 2026 年《经济学人》本地音频保存到私有 R2 桶，使用 Cloudflare Worker 提供文章音频和 Range 播放；把外刊插图和 Expo Web 静态导出放到 Workers Static Assets。只让 2026 年文章引用录音，保留其他年份文章和本地原始文件。此阶段不切断现有 Render API 或 Neon 数据库；全功能 API、任务队列和数据迁移作为下一独立阶段实施。

## 现状

- 2026 年共有 2,725 个 MP3、8,383,477,481 字节；其中 2,674 个可唯一关联文章，其余 51 个只归档，不猜测文章 ID。
- 外刊插图有 17,164 个 WebP，共 1,343,200,014 字节，最大单文件约 1.55 MB。
- 当前配置的 Neon 数据库约 58 MB，有 28 个用户和练习、导入记录。迁移 API 时须完整保留这些数据。
- 现有移动客户端的 API 地址在构建时写入；已安装版本切换 API 需要新版本或保留旧地址的兼容转发。

## 部署结构

```text
Expo iOS/Android/Web
  ├─ 业务 API ──────────────► 现有 Render + Neon（过渡阶段）
  ├─ 2026 原刊录音 ─────────► Cloudflare Audio Worker ─► 私有 R2 桶
  └─ 外刊插图 ──────────────► Workers Static Assets

Expo Web 静态导出 ──────────► 独立 Workers Static Assets 项目
```

R2 音频使用 Standard 存储类，匹配文件的稳定键为 `audio/2026/<articleId>.mp3`；未匹配文件放在 `audio/2026/unmatched/` 下且不通过文章接口公开。Worker 只接受已有文章 ID 格式，按需从 R2 流式返回完整内容或单段字节，并设置 `Content-Type`、`Content-Length`、`Accept-Ranges`、`Content-Range`、`ETag` 和合理缓存头。桶不开启公共访问，也不把上传凭证放入客户端或仓库。

客户端用公开的 `EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN` 和 `EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN` 分别指向两个 Cloudflare 项目。变量未配置时，开发环境仍可使用现有 API 地址。移除 2025 年本地和出版方录音在客户端的关联，保留正文及朗读回退。现有 Render 音频路由可在配置 Cloudflare 音频地址后临时重定向旧客户端；未配置时仍走本地文件。

## 免费额度与发布条件

2026 年音频本身低于 R2 Standard 每月 10 GB-month 免费量；上传前需查看 Cloudflare 账号中其他 R2 存储和当月用量，避免合计超额。插图和 Web 使用静态资源，不占 R2 空间。Audio Worker 受免费计划的每日请求量与单次 CPU 限额约束。部署不升级 Workers Paid，不创建 Container。

发布顺序：生成 2026 清单 → 登录并核对 R2 用量 → 创建私有桶 → 断点续传上传并核对对象数、大小和校验值 → 发布音频与插图静态项目 → 构建并发布 Web → 配置客户端构建环境及旧 API 临时转发。任何上传或部署失败均保留现有 Render/Neon 服务及本地文件，不删除远端旧资源。

## 后续全量迁移

现有服务含 25 张 PostgreSQL 表、数据库租约任务处理、`sharp`、PDF 和 HEIC 解析。D1 是 SQLite，不能直接导入 PostgreSQL schema；免费 D1 单库上限 500 MB，现有临时二进制最大 10 MiB，须改存 R2。下一阶段需逐模块移植 API、任务和导入处理，保留共享契约与幂等语义，完成数据迁移与客户端切换后才可停用 Render/Neon。若免费限制阻止功能等价，应报告具体路由和限制，而不默默删减功能。

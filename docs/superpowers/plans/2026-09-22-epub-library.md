# EPUB 外刊导入实施计划

> 执行工作流：executing-plans。用户已确认按现有格式拆篇并在应用内阅读。

**目标：** 将固定来源的 215 本 EPUB 全部接入“更多”。

**架构：** Python 离线解析、校验并生成索引与每期正文，TypeScript 延迟读取正文；插图存入服务端资源目录并按需请求，避免 Metro 同时打开 17,000 多张图片。现有阅读器与存储沿用稳定 ID，列表分批展示。

**技术：** Python 3、lxml、Pillow、Expo SDK 57、React Native、Jest。

## 全局约束

- 不覆盖工作区已有中文校订；不修改数据库、凭证或真实 AI 任务。
- 原始 EPUB 仅存在 `.local-test-results/epub-import`；生成内容可重复构建。
- 原文标题作为未翻译文章的显示标题，不生成虚假中文摘要。

## 任务

- [x] `scripts/import-english-epubs.py`：固定清单下载、Git blob 校验、NCX 拆篇、两类 XHTML 正文解析、图片压缩及去重、完整性报告。测试 `scripts/test_import_english_epubs.py` 覆盖目录顺序、导航清理、图片与混排。
- [x] `app/src/features/editorial/epub/`：生成元数据、215 本期刊报告、逐期正文与资源加载器。新增 `epubCatalog.ts` 将其适配为 EditorialArticle，复用已有一期。
- [x] `catalog.ts`：追加新文章，按 ID 索引查询，扩展搜索期刊日期。验证原文章 ID 和已校订内容保留。
- [x] `EditorialHomeScreen.tsx`：更多页加入刊物、年份筛选与分页；搜索和切换筛选重置分页，保留原概述路由与卡片。
- [x] `epubCatalog.test.ts` 及首页交互测试：完整目录、唯一 ID、按需正文、分页/筛选/打开文章。
- [x] `server/src/modules/editorial/routes.ts`：公共图片流、严格文件名校验、ETag/缓存及 HEAD；图片迁移到 `server/assets/editorial/epub`。
- [x] 运行 `npm run check`、Web 导出和服务端构建。初次 Expo lint 未找到环境中的 npx；补齐临时 CLI 后单独重跑全仓 lint 通过（0 错误，19 项既有警告）。客户端 262、服务端 260、契约 30 项测试通过；Python 拆篇回归 6 项通过。

最终结果：215 个 EPUB，9,538 篇去重后文章，17,164 张可解码插图；427 篇重复内容、6 个源缺正文游戏条目、5 处源缺图片引用均可在报告中追溯。浏览器完成更多页、刊物筛选、概述和正文阅读验证。

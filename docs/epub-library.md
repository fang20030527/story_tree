# 外刊 EPUB 目录

来源：<https://github.com/hehonghui/awesome-english-ebooks/tree/31d15f6ae17b7ca1c622ed8488e11e9cf6669f8c>。

## 本次导入

- 检查全部 215 个 EPUB，按目录拆篇并合并旧版 Calibre 的续篇文件。
- 去除重复内容后共收录 9,538 篇，其中包括原先已校订的 2026-09-19 经济学人 76 篇；沿用其 ID、中文标题及阅读记录。
- 不同文件中重复的 427 篇只在列表显示一次；每个 EPUB 都保留来源和篇数记录。
- 六个 Caleb’s Inferno 游戏目录条目在原包中没有正文，记录在 `excludedEntries`，不生成空白文章。
- 新导入文章保留英文原题和导语；列表另有中文译题、中文主题及按正文估算的雅思阅读难度。

完整清单与来源缺图、目录重复、图片路径修复、视频首帧转换记录：`app/src/features/editorial/epub/import-report.json`。

中文元数据保存在 `app/src/features/editorial/epub/metadata-zh.json`。英文原题仍保留在索引中，便于对照；没有足够正文的图表条目标为「难度待评估」。新增期刊的中文标题须补全后才能通过目录测试，不能把英文原题直接显示为译题。

## 使用与部署

打开「外刊 → 精选外刊 → 更多」，按刊物、年份筛选或搜索标题、来源、分类和期刊日期。每页 24 篇；点击文章进入原有概述和查词阅读页面。

索引与各期正文在客户端，正文模块在打开文章后才加载。新增插图位于 `server/assets/editorial/epub`，通过 `/v1/editorial/images/:id` 按需下载，支持内容摘要 URL、ETag 和长期缓存。**需要同步更新服务端并保留此资源目录**，客户端继续使用已有 `EXPO_PUBLIC_API_BASE_URL`。原先内置的文章插图保持不变。未配置服务或首次离线阅读时，新增正文仍可打开，插图需要网络。

本次新增正文及索引约 102 MB、插图约 1.34 GB。图片不进入客户端安装包；部署服务端时必须包含资源文件，单独复制 `server/dist` 不足以提供插图。Render 的仓库构建与工作区启动方式保留这些文件，无须数据库迁移。

## 原刊音频

仓库快照提供 15 份《经济学人》逐篇音频清单，覆盖 2025-01-04 至 2025-04-12；这些录音从出版方 HTTPS 地址在线加载。另有本地音频目录，按 `2025/期号/`、`2026/期号/` 保存 MP3。运行 `python scripts/import-economist-local-audio.py "D:/电脑操作/Economist_Audio"` 后，脚本按期号和标题关联录音。本次扫描 6,443 个文件，其中 6,246 条能唯一对应到外刊文章；其余条目因标题或期刊内容无法唯一对应，记录在 `audio-local-report.json`，不会猜测关联。2025-12-20 的重复篇关联到目录中保留的同文文章。

本地录音优先于同一文章原有的出版方 URL。客户端 `audio-local.json` 保存文章 ID 与 API 路径，服务端 `server/assets/editorial/audio-local.json` 保存文章 ID 与音频相对路径；API 从 `app/.env` 中 `EDITORIAL_AUDIO_ROOT` 指定的根目录按需读取音频，并支持播放进度拖动，不会把约 18.5 GB 的文件复制到仓库或客户端安装包。播放 URL 只含文章 ID，不暴露磁盘文件名。开发服务所在电脑必须能访问该目录；部署到其他主机时，也要把相同目录结构提供给服务端并配置该变量。2026-09-19 的精选期刊也会关联本地录音。

较新的 EPUB 没有随附可核验的逐篇录音清单或音频文件。对此类有正文的文章，概述和阅读页显示「AI配音 · 非原刊录音」；声音由设备内置 TTS 生成，无需额外的配音 API。概述页只在按下播放时读取正文。设备朗读按短片段依次播放以适应系统语音输入上限，切换页面时停止。iOS 实机若无声，需检查设备静音模式。今后取得可核验的逐篇录音 URL 后，可继续通过 `epub/audio.json` 关联，真实录音优先于合成朗读。

`epub/audio.json` 保存文章 ID 与出版方音频 URL，`epub/audio-report.json` 保存源文件路径、Git blob、匹配结果和未匹配条目。`epub/audio-local.json` 与 `epub/audio-local-report.json` 保存本地录音关联及核对结果。重新导入 EPUB 后运行 `python scripts/import-editorial-audio.py` 和 `python scripts/test_import_editorial_audio.py`；本地音频目录更新后运行 `python scripts/import-economist-local-audio.py <音频根目录>`。两种录音均通过期号和标题关联；同一文章出现多份本地文件或标题仍有歧义时，不会任意关联。

## EPUB 重建步骤

准备 Python 3 和 `lxml`、`Pillow`、`imageio-ffmpeg`，在仓库根目录运行：

```sh
python scripts/import-english-epubs.py --workers 6
python scripts/enrich-editorial-metadata.py
python scripts/test_editorial_metadata.py
python scripts/test_import_english_epubs.py
npm run check
npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke --max-workers 2
```

原始 EPUB、下载校验信息和解析缓存仅保存在被忽略的 `.local-test-results/epub-import`。脚本固定 Git 提交并验证 Git blob SHA；失败时不发布新索引。`--limit` 仅供开发试验，会生成部分目录，正式数据必须不带此参数重建。修改解析规则后应更新脚本内解析缓存版本。

中文元数据脚本会保留原题未变的已有译题。新增英文标题需提供英文原题到中文译题的 JSON 映射，并运行 `python scripts/enrich-editorial-metadata.py --titles path/to/title-translations.json`；缺译题时脚本拒绝写入。中文主题按刊物栏目和明确的标题关键词归类，难度依据正文句长与长词比例估算，不等同于官方雅思评级。

期刊目录按唯一资源路径拆篇；正文按原 DOM 顺序提取段落、列表、表格和图片。插图转换为最长 1600×2400 的 WebP；原包用 img 引用的视频保留首帧。缺失图片保留可见提示，不能读取的完整期刊使导入失败。

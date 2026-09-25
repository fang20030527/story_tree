# 外刊 EPUB 目录

来源：<https://github.com/hehonghui/awesome-english-ebooks/tree/31d15f6ae17b7ca1c622ed8488e11e9cf6669f8c>。

## 本次导入

- 检查全部 215 个 EPUB，按目录拆篇并合并旧版 Calibre 的续篇文件。
- 去除重复内容后共收录 9,538 篇，其中包括原先已校订的 2026-09-19 经济学人 76 篇；沿用其 ID、中文标题及阅读记录。
- 不同文件中重复的 427 篇只在列表显示一次；每个 EPUB 都保留来源和篇数记录。
- 六个 Caleb’s Inferno 游戏目录条目在原包中没有正文，记录在 `excludedEntries`，不生成空白文章。
- 新导入文章保留英文原题和导语；列表另有中文译题、中文主题及按正文估算的雅思阅读难度。概述页首次打开英文导语时请求中文翻译，并在设备上缓存结果；离线且尚无缓存时可重试。

完整清单与来源缺图、目录重复、图片路径修复、视频首帧转换记录：`app/src/features/editorial/epub/import-report.json`。

中文元数据保存在 `app/src/features/editorial/epub/metadata-zh.json`。英文原题仍保留在索引中，便于对照；没有足够正文的图表条目标为「难度待评估」。新增期刊的中文标题须补全后才能通过目录测试，不能把英文原题直接显示为译题。

## 使用与部署

打开「外刊 → 精选外刊 → 更多」，按刊物、年份筛选或搜索标题、来源、分类和期刊日期。每页 24 篇；点击文章进入原有概述和查词阅读页面。

索引与各期正文在客户端，正文模块在打开文章后才加载。新增插图通过 Web Worker 同源的 `/v1/editorial/images/:id` 按需下载，API 的 `IMAGE_SERVICE` 绑定转发到插图 Worker。原刊录音也通过 Web Worker 同源的 `/v1/editorial/audio/:id` 提供。客户端的媒体地址须与当前部署的 Web origin 一致。未配置服务或首次离线阅读时，新增正文仍可打开，插图需要网络；文章封面会显示随安装包提供的刊物标识。

本次新增正文及索引约 102 MB、插图约 1.34 GB。图片不进入客户端安装包，由独立插图 Worker 提供；更换客户端媒体 origin 时须验证图片和录音路径均能返回资源。

## 原刊音频

当前应用只关联 2026 年《经济学人》原刊录音。运行 `python scripts/import-economist-local-audio.py "D:/电脑操作/Economist_Audio/2026"` 后，脚本按期号和标题关联录音。本次扫描 2,725 个 MP3，其中 2,674 个能唯一对应文章，另 51 个只在 `audio-local-report.json` 中记录，不猜测关联。2025 年文章正文仍保留，但不再提供原刊录音；本地原始文件没有删除。

客户端 `audio-local.json` 保存文章 ID 与 API 路径，服务端 `server/assets/editorial/audio-local.json` 保存文章 ID 与音频相对路径。2026 年全部 2,725 个 MP3 存入私有 Cloudflare R2 桶；Audio Worker 按文章 ID 流式提供已匹配的录音，支持播放进度拖动。51 个未匹配文件只归档，不通过文章接口公开。生产客户端的 `EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN` 指向 Web Worker，由其 `AUDIO_SERVICE` 绑定读取录音；旧版客户端仍使用旧地址。开发服务可通过 `EDITORIAL_AUDIO_ROOT` 从本机读取。播放 URL 不含磁盘文件名，也不把约 8.38 GB 音频复制到仓库或安装包。详见 [Cloudflare 部署说明](../cloudflare/README.md)。

没有匹配到 2026 年原刊录音的文章，概述和阅读页显示「AI配音 · 非原刊录音」；声音由设备内置 TTS 生成，无需额外的配音 API。概述页只在按下播放时读取正文。设备朗读按短片段依次播放以适应系统语音输入上限，切换页面时停止。iOS 实机若无声，需检查设备静音模式。

`epub/audio-local.json` 与 `epub/audio-local-report.json` 保存 2026 年录音关联及核对结果。重新导入 EPUB 或更新本地音频后，运行 `python scripts/import-economist-local-audio.py <2026 年音频目录>`。同一文章出现多份文件或标题仍有歧义时，脚本不会任意关联。旧的 2025 年出版方音频清单已从项目中移除。

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

# 跟读素材预置双语字幕

平台电影、剧集、演讲和播客的中文译文写入字幕的 `zh` 字段，与英文 `en` 和原时间轴一起发布。打开跟读或切换双语时直接显示预置字幕，无须登记匿名账号或调用翻译服务。

只有用户导入的素材（客户端 `origin: "file"`，包括导入的 YouTube 素材）会使用句子翻译 API。已有中文优先使用；缺少的中文按当前句和可见台词按需补齐，缓存按账号、素材、句子编号和英文原文区分。

## 数据和发布包

- `server/content/speaking/cloud-catalog.json` 保存平台媒体的完整字幕。
- `server/content/speaking/translation-corrections.json` 保存复核后的译文，绑定素材编号、句子编号及完整英文原文，避免套用到已经修改的句子。
- 发布包中的 `<material-id>/material.json` 自带完整中英字幕；`catalog.json` 只保存摘要，客户端按需读取详情。
- 写入预译时保留英文、句子编号和起止时间，更新该素材的字幕版本。客户端随后清除旧版可丢弃字幕缓存，收藏、笔记和本机校正继续保留。
- API 在没有个人字幕覆盖时采用平台发布版本；已有播放进度不会把字幕版本重置为 1。个人字幕校正仍使用账号自己的版本与冲突校验。

## 离线制作

使用本机模型服务生成译文，接口只允许连接本机地址；不会把平台字幕发送到外部翻译 API。此次使用 HY-MT2-7B 预译，并复核截图场景、常见惯用表达和被检查标记的异常段落。整份语料没有逐句人工校审。

```powershell
# 先在本机启动兼容 OpenAI 协议的翻译模型服务（默认端口 8897）。
node --import tsx scripts/translate-speaking-subtitles.mjs --generate

# 全部译文齐备后写入字幕；缺失译文会阻止写入。
node --import tsx scripts/translate-speaking-subtitles.mjs --apply

# 离线生成与云端格式相同的发布包，无须云端凭证。
node --import tsx scripts/publish-speaking-catalog.mjs --output-dir .local-test-results/speaking/bilingual-subtitles/release
```

断点文件位于被 Git 忽略的 `.local-test-results/speaking/bilingual-subtitles/`，同一素材、同一句子且英文完全相同才复用译文。人工校正优先。结构异常、缺少中文或超过合理长度的结果会重试；一组结果出现格式错乱时整组改为逐句处理。带英文引号的段落也逐句处理，避免合并分句。

需要上线时使用已有发布命令：

```powershell
npm run cloudflare:publish:speaking
npm run cloudflare:publish:speaking -- --apply
```

发布前会检查平台每句字幕是否自带中文，并核对原媒体对象。详情全部写入并回读核验后，才更新目录摘要。未来新增平台素材也必须先完成预译再发布。

## 验证

此次共完成 57 份平台素材、54,248 句中英字幕。其中补齐 52,429 句中文，保留原有 1,819 句中文；50 份素材的字幕版本由 1 升至 2。另保存 144 条与原文绑定的复核校正。

相关测试覆盖预置中文立即显示、平台不读取旧 API 翻译缓存也不调用翻译接口、用户导入仍可翻译、新发布版本刷新旧英文字幕缓存，以及服务端和 Cloudflare 中个人字幕覆盖与发布版本的关系。客户端、服务端和 Cloudflare 共 99 项相关测试通过，相关类型检查和代码检查通过。

发布包已通过实际 Cloudflare 目录和详情读取逻辑的本地回读校验：57 份详情与源数据完全一致，每句均有中文，详情和摘要版本一致，英文、句子编号及时间轴未被修改。摘要为 35,381 字节，最大详情为 709,425 字节，均在读取限制内。重复写入也已验证为无变更。

本次完成的是本地字幕数据和发布包，尚未写入线上存储或部署客户端、API。离线包保存在 `.local-test-results/speaking/bilingual-subtitles/release/`，压缩包为同目录的 `platform-bilingual-subtitles.zip`。

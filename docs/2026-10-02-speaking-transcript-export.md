# 台词本 PDF 与 Word 导出

素材详情页及影子跟读页的「更多」菜单新增「导出台词本」。两种格式都使用当前完整字幕，保留标题、素材信息、逐句序号、起止时间、英文、已有中文译文和已保存笔记。查找、收藏筛选、分段及字幕遮挡不会删减导出内容；尚未加载完整或没有字幕时禁用导出。

## 平台行为

- iOS、Android：PDF 由系统 HTML 打印引擎生成，Word 生成标准 `.docx`；随后打开系统分享面板，可保存到文件或交给兼容应用。文件使用素材标题命名，分享结束或失败后清理临时文件。
- Web：Word 直接下载 `.docx`；PDF 在独立窗口显示台词本并打开打印对话框，选择「另存为 PDF」。不会打印跟读页的播放器、工具栏等界面。浏览器阻止弹窗时显示可重试提示。
- 导出在客户端完成，不新增服务端接口、数据库迁移或 AI 调用。中文译文使用已有字幕，缺少译文的句子保留英文，不生成空行或自动补译。

## 实现

- `transcriptDocument.ts` 负责 HTML、DOCX、文件名及完整字幕检查。DOCX 是包含文档、样式、关系及页码页脚的 OOXML ZIP，正文可以在 Word 编辑。两种格式使用 A4 页面。
- `transcriptExport.ts` 与 `.web.ts` 分别负责原生保存分享及浏览器下载打印。原生模块按需加载。
- `SpeakingTranscriptExport.tsx` 提供统一入口、忙碌状态、重复点击保护和错误重试。异常不把系统路径或内部错误展示给用户。
- 依赖使用 Expo SDK 57 对应的 `expo-print`、`expo-sharing`，以及项目已有版本的 `fflate`。动态 Expo 配置已注册分享插件。

原生版本需要重新构建并安装 App，才能包含新增模块。相关文档：[Expo Print](https://docs.expo.dev/versions/v57.0.0/sdk/print/)、[Expo Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/)、[Expo FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/)。

## 验证

- 五个相关测试套件共 18 项通过：完整字幕与笔记、中文与特殊字符、OOXML 解析及关系、小时级时间戳、无字幕禁用、重复点击、失败重试、原生分享与清理、浏览器下载及独立打印。
- 客户端完整测试 93 个套件、491 项通过；全工作区类型检查与单独运行的全仓 Lint 通过（24 项原有客户端警告，零错误）。
- Expo Web 成功导出 39 条路由。真实 Chrome 页面点击 Word 后下载得到可解析的 DOCX，点击 PDF 后独立打印窗口包含完整台词及笔记，没有页面运行时错误。核对了桌面及 390px 手机宽度的入口。
- 18 句双语、多行笔记样例的 PDF 和 Word 均生成三页。PDF 逐页渲染检查中文、换行和分页；Word 通过 Microsoft Word 打开、导出 PDF，并逐页核对排版和页码。环境缺少 LibreOffice，未用其进行兼容性验证。
- 客户端密钥检查通过，858 个客户端文件未发现服务端密钥泄漏。
- iOS JavaScript/Hermes 资源导出通过，包含新增导出依赖；这不等于已经构建或安装了含新增原生模块的 App。
- 完整 `npm run check` 初跑的服务端结果为 433 项通过、2 项生词库测试失败：数据库时间略超前时，新词被归入未到时间。检查期间工作区另有生词库优先级修正；本功能未改动该实现。针对 `scheduler.test.ts` 与 `word-service.integration.test.ts` 的两个失败用例在当前代码中复测均通过，其余用例未再次重跑，因此不把初次完整 `check` 记为成功。契约测试 55 项、小程序测试 9 项通过。
- 尚未在 iOS、Android 真机验证系统生成 PDF、分享面板和接收应用的完整流程。

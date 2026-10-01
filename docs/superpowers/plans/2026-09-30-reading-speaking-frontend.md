# 阅读与口语真实前端实施计划

> 执行方式：在当前会话按任务实施并检查，使用当前工作区的最新前端；保留已有音频播放器等未提交修改。

**目标：** 将已确认的模式、素材、文件、影子跟读与 VIP 原型迁入 Expo 客户端。

**架构：** 阅读继续使用现有功能。学习模式由独立 Context 管理；口语数据、媒体与练习记录使用当前账号的本地存储。播放器使用 Expo Audio／Video 的真实时间事件；订阅和自动字幕缺少服务端契约时显示不可用状态。

**技术：** Expo SDK 57、React Native、expo-router、expo-audio、expo-video、expo-document-picker、expo-file-system、AsyncStorage、Zod。

## 全局约束

- 名称使用「阅读／口语」；口语导航为「素材／文件／我的」。
- 使用现有暖白、深墨、朱橙、豆沙粉和 Instrument Serif／Source Serif 4。
- 不加入 AI 发音评分与纠错；不虚构付费、兑换、识别或 AI 讲解成功。
- 不修改数据库、服务端或现有阅读流程；不提交已有工作区修改。
- 原生文件复制到持久目录，Web 媒体保存在 IndexedDB；字幕、收藏与记录按账号隔离。

## 任务 1：模式导航与个人页

文件：`app/src/context/LearningModeContext.tsx`、`app/src/features/speaking/LearningModeMenu.tsx`、`app/src/app/_layout.tsx`、`app/src/app/(tabs)/{_layout,index,shelf,profile}.tsx`。

- [x] 提供 `LearningMode = 'read' | 'speak'` 和 `useLearningMode(): { mode, setMode }`，读取与写入 AsyncStorage，避免延迟读取覆盖用户选择。
- [x] 我的标题组合为模式按钮；菜单使用 Modal，外部点击和返回键关闭；选中后留在我的。
- [x] 首页与书架路由按模式选择组件；口语隐藏词库，动态更新底部与侧边标签。
- [x] 保留阅读个人统计、词库请求与学习日志；口语显示真实本地记录，初始为零。
- [x] 检查模式持久化与恢复、个人页菜单、阅读回归。

## 任务 2：口语数据、素材与文件

文件：`app/src/features/speaking/{model,catalog,speakingStorage,mediaStorage,mediaStorage.web,useSpeakingLibrary,SpeakingHomeScreen,SpeakingFilesScreen,SpeakingDetailScreen,SpeakingHistoryScreen}.ts*`。

接口：`SpeakingCue = { id, start, end, en, zh }`；`SpeakingMaterial = { id, title, subtitle, category, origin, mediaType, mediaId?, duration, cues }`。资源查询返回真实文件或内置示范；读取失败显示重试，不替换成演示文件。

- [x] 内置三组原创素材，配合成示范音与根据生成声音时长确定的字幕，明确标注音源。
- [x] 原生和 Web 分别保存真实媒体文件；元数据串行写入当前账号键。
- [x] 实现分类、详情、继续跟读、文件筛选、空状态和真实历史。
- [x] 检查数据隔离、存储失败与重复保存不丢失记录。

## 任务 3：文件导入与字幕校正

文件：`app/src/features/speaking/{subtitles,SpeakingImportScreen,SpeakingEditorScreen}.ts*`，路由 `app/src/app/speaking/{import,edit}.tsx`。

- [x] 通过用户点击启动 DocumentPicker，校验音视频类型与大小，再持久保存。
- [x] 解析 SRT／VTT 时间轴；校验非空英文、有限时间、顺序与相邻重叠。
- [x] 自动识别入口显示服务尚未开放；允许导入已有字幕或手动添加，绝不生成虚假识别结果。
- [x] 校正保存后进入跟读；取消与保存失败保留可重试状态。
- [x] 测试双语、多行、VTT 设置、非法时间和重叠字幕。

## 任务 4：真实跟读播放器与录音

文件：`app/src/features/speaking/{ShadowingScreen,ShadowingMedia,useShadowingPlayback,ShadowingRecording,ShadowingSettings,SpeakingComponents}.ts*`，路由 `app/src/app/speaking/shadowing.tsx`。

- [x] Audio 与 Video 共用 `PlaybackController = { play, pause, seek(seconds), setRate(rate) }`，状态包括当前时间、时长、加载与错误。
- [x] 同步当前句、定位上下句、拖动进度、变速、逐句及 AB 循环；循环次数与停顿读取实际播放器事件。
- [x] 提供字幕四种显示、遮挡与揭开、自动滚动、收藏过滤、查找、字幕编辑和分段显示。
- [x] 讲解显示素材配套注释，字幕查词复用离线词典；AI 台词讲解明确尚未开放。
- [x] 点击录音才申请麦克风，原音与回放互斥；录音保存、停止、回放、重录；离开和后台停止音频。
- [x] 根据真实练习时长保存个人记录，保存失败可重试。
- [x] 测试播放定位、循环边界、手动暂停取消循环、录音失败与持久记录。

## 任务 5：VIP 页面

文件：`app/src/features/subscription/{plans,SubscriptionScreen}.ts*`、`app/src/app/pro.tsx`、`app/src/__tests__/pro.test.tsx`。

- [x] 套餐前置：月度 ¥19／年度 ¥128／永久 ¥198，均价同步，默认月度。
- [x] 阅读四项、口语十一项权益，进入时默认当前模式；切换权益不改变模式或套餐。
- [x] 保留深色品牌主视觉、固定底部操作区、兑换入口、说明和返回；未开放的交易按钮显示禁用状态。
- [x] 未开放购买或兑换时禁用交易，允许查看方案说明；离线、PDF、YouTube、TED 标记规划中。
- [x] 测试套餐、分类、返回与没有虚假权益更新。

## 任务 6：整体验证与交付

- [x] `npm run typecheck --workspace=app`：无 TypeScript 错误。
- [x] `npm test --workspace=app`：通过新增逻辑与原客户端回归。
- [x] `npm run lint --workspace=app`：通过。
- [x] `npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke`：成功导出真实前端。
- [x] 浏览器检查手机窄屏、桌面、模式导航、素材播放器、实际文件导入与订阅，保存实际客户端截图。深色沿用主题变量，未单独进行设备视觉验收。
- [x] 文档记录可用功能与缺少后端服务的具体边界。

交付详情与原生验证边界见 `docs/reading-speaking-frontend.md`。客户端完整回归 75 个套件、384 项测试通过；最后局部调整后，相应 8 项测试再次通过。TypeScript、Lint、Web 导出和客户端密钥检查通过。未进行支付、语音识别或真机录音联调。

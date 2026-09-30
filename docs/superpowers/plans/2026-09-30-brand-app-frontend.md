# 黑洞英语正式前端迁移实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已通过多轮原型反馈确认设计，并授权开发真实前端；本会话直接执行。

**Goal:** 将已经确认的阅读刊物视觉与手机、iPad、Web 布局应用到现有 Expo 客户端，保留真实业务和数据，并交付独立原生微信小程序工程。范围为 iPhone、iPad、Web 和微信小程序，暂不制作 Android。

**Architecture:** 沿用 expo-router、ThemeContext、领域组件和已有 API。主题提供品牌语义色与本地字体；通用组件负责品牌页眉、标题、统计、触控反馈和响应式宽度。页面仍从现有存储与服务获取内容，不使用原型的模拟数据。

**Tech Stack:** Expo SDK 57、React 19.2、React Native 0.86、TypeScript、expo-image、expo-font、Jest。

## 全局约束

- 当前批准样稿为 `docs/visual-preview/app` 和 `docs/visual-preview/platforms`；这些样稿保留。
- 纸色 `#FBFAF6`、墨色 `#252620`、朱橙 `#B53720`、豆沙粉 `#E59EB4`。正文与低对比度背景分别校核；词库海报白字使用更深的粉色底以满足可读性。
- 字体为 Instrument Serif 标题、Source Serif 4 正文，中文使用系统字体；字体加载失败仍能操作。
- 不改数据库、原生安装身份安全存储、幂等提交、额度和 FSRS 策略。Web 新增会话级凭据存储。
- 手机使用底部导航，宽屏使用侧边导航；阅读正文限制宽度。
- 统计必须来自现有接口或实际本地记录；错误、未知与零值分开。
- 原型会员价格仅作为待上线方案展示；无支付/兑换接口时不开通会员、不扣费、不接受演示兑换码。
- 微信小程序另建 `miniprogram/` 原生 WXML/WXSS/Page 工程，共享 Zod 契约，不加载原型 HTML。

## 文件与职责

- `app/src/constants/theme.ts`：品牌主题与字体名。
- `app/src/components/brand.tsx`：Logo、品牌页眉、页面标题、均分统计、触控反馈组件。
- `app/src/components/ResponsiveFrame.tsx`：宽屏主画布和子页面限宽。
- `app/src/app/_layout.tsx`、`(tabs)/_layout.tsx`：字体加载、状态栏、响应式导航。
- `app/src/features/editorial/EditorialHomeScreen.tsx`：固定每日精选，下面主题/外刊筛选、搜索和刊期索引。
- `app/src/features/shelf/ShelfScreen.tsx`、`ShelfRow.tsx`：顶部导入、实际续读和书架内容。
- `app/src/app/(tabs)/words.tsx`：待复习海报、均分真实统计、生词本。
- `app/src/app/(tabs)/profile.tsx`、`features/study/StudyLog.tsx`：紧凑账号与 VIP 入口、真实学习日志。
- `app/src/app/pro.tsx`：VIP 权益与未开放购买/兑换状态。
- 阅读、练习、导入、登录、设置页面：语义颜色、间距、字体和响应式容器统一。

## 执行与验证

### 1. 主题与布局
- [x] 复制本地字体及许可证到 `app/assets/fonts`。
- [x] 为 Theme 添加 `pink`、`onPink`、`vip`、`onVip`，替换旧金黄配色。保持旧语义字段供所有业务页面使用。
- [x] 实现 `BrandHeader({action?})`、`PageHeading({title, description?})`、`StatRow({items})` 与 `TouchCard({onPress, children, style, accessibilityLabel})`。
- [x] 用 `useFonts` 加载字体；保留错误回退。宽屏导航使用 Expo Router 既有 Tabs 的侧边位置，手机底部导航考虑安全区。
- [x] 执行 `npm run typecheck --workspace=app` 和主题/导航测试。

### 2. 外刊与书架
- [x] 精选卡完整点击区域进入 `/editorial/[id]`；箭头不直接进入正文。收藏动作位于文章概述页，独立并持久化。
- [x] 主题、外刊、年份和原刊音频筛选只影响发现列表，精选不变。保留按刊期浏览、分页、刷新和搜索。
- [x] 顶部品牌页眉统一。书架导入文字入口与管理入口独立；实际最近阅读用于续读，空书架显示真实空态。
- [x] 添加固定精选与筛选组合的回归测试，运行已有外刊、书架、收藏测试。

### 3. 词库、我的与学习日志
- [x] 词库只显示服务端实际待复习数量，三列均分居中；无法读取云端时显示错误与重试。
- [x] 智能选词保留服务端记忆曲线挑词，自定义入口支持真实词库多选及已有可编辑单词输入，不显示自动选中的具体词。
- [x] 我的页使用真实账号、最近阅读和云端词库数量；移除硬编码生词数。
- [x] 学习日志按本地日期生成最近 13 周网格，学习时长使用现有 `studyStorage`；点格子显示当天时长，未来日期不标为已学。
- [x] 测试跨年日期、真实时长和错误状态；运行词库、个人页、练习相关测试。

### 4. VIP 与关联页面
- [x] Pro 文案统一 VIP。展示权益、三个待上线方案与邀请码输入，显式未开放；不返回模拟兑换成功。
- [x] 统一阅读、查词、导入、登录、设置、练习按钮与文本颜色，所有页面适配浅深主题。
- [x] 运行相关页面回归测试，不移除年龄确认、删除确认或错误重试。

### 5. 交付
- [x] 通过 `scripts/test-local.ps1` 完整执行全仓库 `npm run check`，退出码 0：类型检查、353 项客户端、293 项服务端、9 项小程序、33 项契约测试全部通过。全工作区 lint 通过（客户端 25 条警告、0 错误）。另有 8 项 Web Worker 测试通过。未运行真实付费生成冒烟。
- [x] 执行 `node ../node_modules/expo/bin/cli export --platform web --output-dir dist-brand`（在 app 目录执行；32 条静态路由）。
- [x] 浏览器检查 390 手机、820 iPad、1440 Web；验证概述导航、主题切换、空态和 VIP 未开放状态，保存截图。
- [x] iOS JS/Hermes 资源导出通过；签名 IPA `1.0.0 (37)` 通过 EAS 构建并上传 TestFlight，Apple 为 `VALID`、`IN_BETA_TESTING`。核对通用设备族 `[1, 2]`、横竖屏、品牌字体、生产 origin 与服务端密钥隔离。iPhone/iPad 原生真机业务验证尚未完成。2026-09-30 用户另行授权推送 main、部署 Web、上传 TestFlight，完整结果见发布记录。

## 微信小程序交付

- [x] 19 个原生页面，Logo 居中，公共目录、真实身份、词库、智能/自定义练习、导入、翻译、自测与学习日志。
- [x] 安全凭据、共享契约、幂等重试、迟到响应防护、无支付接口时的真实状态。
- [x] 独立构建和 TypeScript 检查通过；9 项编译产物运行时测试通过，主包约 595 KiB。
- [x] 中文配置与开发者工具导入说明。
- [ ] 微信开发者工具与微信真机验证：当前电脑无开发者工具，需要自己的小程序 AppID 和合法域名。

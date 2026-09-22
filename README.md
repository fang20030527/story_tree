# 黑洞英语

这是一个云端生词长文练习工作区：Expo 客户端按单词查看复习安排并设置目标词数，Fastify 服务端使用 FSRS 优先选择待复习单词，在文章语境中练习具体含义，使用 Neon PostgreSQL 持久化数据，并由内置任务处理器通过 EvoLink 生成阅读练习、导入英文文章和翻译。

同词不同释义共享一份复习计划，词库显示“全部／待复习／未到时间”，待复习数量来自整个词库。升级时先运行数据库迁移，再启动服务端和客户端；旧释义、例句和历史答案保留，服务端首次读取或作答时按历史重建单词进度。

## 工作区

- `app/`：Expo SDK 57，支持 iOS、Android 和 Web 编译。云端身份使用原生 SecureStore，因此完整业务流程需在 iOS 或 Android 上运行。
- `server/`：Fastify API、PostgreSQL 任务队列和同进程 worker。
- `packages/contracts/`：客户端与服务端共用的 Zod API 契约。
- `server/drizzle/`：显式执行的数据库迁移。

## 准备

1. 安装 Node.js 22.13 或更高版本和 npm。
2. 复制 `app/.env.example` 为 `app/.env`。
3. 填写 `DATABASE_URL`、`EVOLINK_API_KEY` 和 `PUBLIC_SERVER_ORIGIN`，并按需要调整其他服务端变量。不要提交 `app/.env`。
4. 当前登录入口使用邮箱和密码，首次成功登录会自动创建账号，不需要邮件服务 API key。若启用微信登录，在服务端填写已审核移动应用的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`；客户端只填写 `EXPO_PUBLIC_WECHAT_APP_ID`、`EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK` 和正式的包标识。`WECHAT_APP_SECRET` 只能存在于服务端环境。
5. 客户端只会读取 `EXPO_PUBLIC_API_BASE_URL` 及明确标记为 `EXPO_PUBLIC_` 的配置，不应包含数据库、EvoLink 或微信 AppSecret。

真机调试时，手机和开发电脑必须在可互相访问的同一局域网。`EXPO_PUBLIC_API_BASE_URL` 和 `PUBLIC_SERVER_ORIGIN` 都应使用开发电脑当前的局域网 IP，不能使用手机视角下的 `localhost`。例如两者都设为 `http://192.168.1.20:3000`。切换 Wi-Fi 后 IP 可能改变，需同时更新两个变量，然后重启 API 和 Expo。

## 文章导入后端

后端支持公开 URL、粘贴正文、1–10 张有序图片、本地 TXT/Markdown/HTML/DOCX/PDF/图片文件，以及十分钟电脑上传码。所有来源都收敛为统一预览与确认接口；客户端解析完成后自动确认，创建仅所有者可读的文章和有序段落，并支持段落/全文翻译缓存。

- 单文件上限 10 MiB，图片批次总上限 30 MiB；临时二进制只存入 Neon `bytea`。
- 成功、终态失败、取消和过期会删除临时二进制；可重试资产最多保留 24 小时，未确认预览最多保留 7 天。
- 扫描型 PDF 不在服务端渲染页面；请把页面导出为图片后从相册导入。
- URL 仅允许公开 HTTP(S) 目标，每次 DNS/重定向都会重新校验并锁定地址；私网、本机、保留地址和云元数据端点不可绕过。
- 电脑上传码和能力 Cookie 有效期均为 10 分钟，只能成功使用一次；原始值不入库。

## 常用命令

```bash
npm install
npm run db:migrate --workspace=@context-reader/server
npm run dev
npm run dev:app
npm run check
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
RUN_IMPORT_LIVE_SMOKE=1 npm run smoke:imports --workspace=@context-reader/server
```

迁移不会随 API 启动自动执行；新环境在启动服务前必须显式运行 `db:migrate`。该命令可安全重跑，不会删除或重建 `public` Schema。`npm run dev` 同时启动 HTTP API、任务 worker 和导入清理器。

## 微信登录

服务端的 `POST /v1/auth/wechat` 接收原生微信 SDK 返回的一次性授权 code，并通过微信开放平台换取身份后绑定当前安装令牌。首次登录会把当前访客身份升级为注册身份；已有数据的访客与另一个微信账号冲突时返回明确的账号合并错误，不会静默丢数据。

微信登录需要微信开放平台审核通过的移动应用 AppID/AppSecret、iOS Bundle ID、Android 包名/签名和 iOS Universal Link。客户端已接入 `expo-native-wechat` 适配入口，但必须用配置了 AppID 的 Expo Development Build；Expo Go 不包含这个原生模块。没有真实凭证时，后端和客户端测试使用假 provider，真实设备联调不会通过。

## 邮箱登录

当前登录页使用邮箱 + 密码，首次成功登录会自动创建邮箱账号。服务端只保存 scrypt 密码哈希，不保存明文密码，也不依赖 SMTP、Resend 等外部邮件 API。邮箱验证码、找回密码和邮箱所有权验证可在后续单独补充。

## 验证与测试安全

`npm run check` 会执行所有工作区的类型检查、测试和 lint；`npm run build` 构建可部署的服务端产物。

数据库集成测试优先使用 `TEST_DATABASE_URL`。未提供时才使用 `DATABASE_URL`，且只创建并清理名称以 `app_test_*` 开头的随机隔离 Schema；不会删除、截断或重建 `public` Schema。

服务端运行方式、API 状态和真实服务冒烟流程见 [`server/README.md`](server/README.md)。

## 英文语境自测

新生成的 AI 文章为每个目标词配一道英文语境填空题：使用不同于文章的新句子、四个英文词或短语选项，以及提交后显示的中英双语选项解析（中文在前、英文在后）和全中文总结。自测页隐藏目标词标题和原文定位，避免直接提示答案。历史练习保留原题和答题记录。

生成器输出 `optionsEn`、`correctOptionIndex`、中文总结 `explanationZh`，以及按选项一一对应的 `optionExplanationsZh` 和 `optionExplanationsEn`。结构检查确保题干、选项及英文解析为英文，中文解析包含中文，总结为全中文，并拒绝重复选项、无效空缺和答案索引；独立 AI 审核目标义项、搭配和答案唯一性。双语选项解析按中文、英文换行保存，中文总结通过原有 `explanationZh` 字段返回，无需数据库迁移。旧练习中已保存的英文解析不会自动翻译。服务端和客户端需一起更新，新题型只影响更新后生成的练习。

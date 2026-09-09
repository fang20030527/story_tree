# 外刊阅读 / Context Reader

这是一个云端生词长文练习工作区：Expo 客户端录入具体词义，Fastify 服务端使用 Neon PostgreSQL 持久化数据，并由内置任务处理器通过 EvoLink 生成阅读练习、导入英文文章和翻译。

## 工作区

- `app/`：Expo SDK 54，支持 iOS、Android 和 Web 编译。云端身份使用原生 SecureStore，因此完整业务流程需在 iOS 或 Android 上运行。
- `server/`：Fastify API、PostgreSQL 任务队列和同进程 worker。
- `packages/contracts/`：客户端与服务端共用的 Zod API 契约。
- `server/drizzle/`：显式执行的数据库迁移。

## 准备

1. 安装 Node.js 22.13 或更高版本和 npm。
2. 复制 `app/.env.example` 为 `app/.env`。
3. 填写 `DATABASE_URL`、`EVOLINK_API_KEY` 和 `PUBLIC_SERVER_ORIGIN`，并按需要调整其他服务端变量。不要提交 `app/.env`。
4. 客户端只会读取 `EXPO_PUBLIC_API_BASE_URL`，不应包含数据库或 EvoLink 密钥。

真机调试时，手机和开发电脑必须在可互相访问的同一局域网。`EXPO_PUBLIC_API_BASE_URL` 和 `PUBLIC_SERVER_ORIGIN` 都应使用开发电脑当前的局域网 IP，不能使用手机视角下的 `localhost`。例如两者都设为 `http://192.168.1.20:3000`。切换 Wi-Fi 后 IP 可能改变，需同时更新两个变量，然后重启 API 和 Expo。

## 文章导入后端

后端支持公开 URL、粘贴正文、1–10 张有序图片、本地 TXT/Markdown/HTML/DOCX/PDF/图片文件，以及十分钟电脑上传码。所有来源都收敛为可编辑预览，确认后创建仅所有者可读的文章和有序段落，并支持段落/全文翻译缓存。

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

## 验证与测试安全

`npm run check` 会执行所有工作区的类型检查、测试和 lint；`npm run build` 构建可部署的服务端产物。

数据库集成测试优先使用 `TEST_DATABASE_URL`。未提供时才使用 `DATABASE_URL`，且只创建并清理名称以 `app_test_*` 开头的随机隔离 Schema；不会删除、截断或重建 `public` Schema。

服务端运行方式、API 状态和真实服务冒烟流程见 [`server/README.md`](server/README.md)。

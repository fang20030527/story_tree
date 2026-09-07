# 外刊阅读 / Context Reader

这是一个云端生词长文练习工作区：Expo 客户端录入具体词义，Fastify 服务端使用 Neon PostgreSQL 持久化数据，并由内置任务处理器通过 EvoLink 生成阅读练习和翻译。

## 工作区

- `app/`：Expo SDK 54，支持 iOS、Android 和 Web 编译。云端身份使用原生 SecureStore，因此完整业务流程需在 iOS 或 Android 上运行。
- `server/`：Fastify API、PostgreSQL 任务队列和同进程 worker。
- `packages/contracts/`：客户端与服务端共用的 Zod API 契约。
- `server/drizzle/`：显式执行的数据库迁移。

## 准备

1. 安装 Node.js 22.13 或更高版本和 npm。
2. 复制 `app/.env.example` 为 `app/.env`。
3. 填写 `DATABASE_URL` 和 `EVOLINK_API_KEY`，并按需要调整其他服务端变量。不要提交 `app/.env`。
4. 客户端只会读取 `EXPO_PUBLIC_API_BASE_URL`，不应包含数据库或 EvoLink 密钥。

真机调试时，`EXPO_PUBLIC_API_BASE_URL` 必须使用开发电脑的局域网 IP，不能使用 `localhost`。例如 `http://192.168.1.20:3000`。

## 常用命令

```bash
npm install
npm run db:migrate --workspace=@context-reader/server
npm run dev
npm run dev:app
npm run check
RUN_LIVE_SMOKE=1 npm run smoke:live --workspace=@context-reader/server
```

迁移不会随 API 启动自动执行；新环境在启动服务前必须显式运行 `db:migrate`。`npm run dev` 同时启动 HTTP API 和生成/翻译 worker。

## 验证与测试安全

`npm run check` 会执行所有工作区的类型检查、测试和 lint；`npm run build` 构建可部署的服务端产物。

数据库集成测试优先使用 `TEST_DATABASE_URL`。未提供时才使用 `DATABASE_URL`，且只创建并清理名称以 `app_test_*` 开头的随机隔离 Schema；不会删除、截断或重建 `public` Schema。

服务端运行方式、API 状态和真实服务冒烟流程见 [`server/README.md`](server/README.md)。

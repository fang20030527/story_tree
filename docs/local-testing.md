# Windows 本地测试

本机已安装 Node.js 24.19.0、npm 12.0.2，以及 package-lock.json 中的全部工作区依赖。
工具目录为 `%LOCALAPPDATA%\context-reader-tools`；npm 和 Node 已加入用户 PATH。
已打开的终端需要重新打开，才能读取更新后的 PATH。

## 一键检查

在项目根目录的 PowerShell 中运行：

```powershell
./scripts/test-local.ps1
```

该命令会按需启动本地 PostgreSQL 18.4，然后执行所有工作区的类型检查、测试和 lint。
数据库只监听 `127.0.0.1:55432`，数据保存在工具目录的 `postgres\test-data`。
它仅用于本机测试，使用本机信任认证；每项数据库集成测试创建并清理独立的 `app_test_*` Schema。
`app/.env.test` 也已配置相同的 `TEST_DATABASE_URL`，数据库运行时可直接执行 `npm run check`。

只启动数据库：

```powershell
./scripts/test-local.ps1 -SkipChecks
```

停止测试数据库：

```powershell
& "$env:LOCALAPPDATA\context-reader-tools\postgres\package\native\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\context-reader-tools\postgres\test-data" -m fast stop
```

## 安装及构建

```powershell
npm ci
npm run build
cd app
npx expo export --platform web
```

`.npmrc` 让锁文件中的镜像下载地址使用官方 npm registry；版本和完整性校验仍以锁文件为准。
`package.json` 中已记录 esbuild 和 unrs-resolver 所需安装脚本的版本级许可，以适配 npm 12。

## 本次验证（2026-09-21）

- 客户端：31 个测试文件、109 项测试。
- 服务端：44 个测试文件、197 项测试，使用真实本地 PostgreSQL。
- 共享契约：1 个测试文件、16 项测试。
- 三个工作区的类型检查通过；lint 无错误，现有测试 mock 仍有 16 条 require 风格警告。
- 服务端生产构建通过；Expo Web 生产导出通过，生成 27 条路由。
- 修复本地配图资源处理及练习页面的 React Hooks 检查问题。

检查输出保存在 `.local-test-results/`。真实 EvoLink/微信联调需要有效服务凭证；本次未执行外部服务付费调用或 Android/iOS 真机验收。

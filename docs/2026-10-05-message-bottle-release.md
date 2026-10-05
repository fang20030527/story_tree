# 留言瓶开发者模式与热更新发布记录

## 代码与验证

- 功能提交：`b9013eca679d95daf206bcb2f68da2c115834b49`，已合并并推送到 `main`。
- Windows 指纹修复：`3f185bf87c7c13c01fe8f3104b4c502dfbfdddfe`，已合并并推送到 `main`。
- 修复前后两次 `npm run check` 均通过：客户端 670 项、服务端 594 项、契约 77 项、小程序 9 项测试；类型检查通过，lint 无错误，客户端保留 24 条既有告警。
- Worker 31 个文件、305 项测试通过，API 类型检查与部署打包检查通过。
- 数据库集成测试使用只监听本机的临时 PostgreSQL 17.11，按现有测试工具创建并清理 `app_test_*` Schema；检查结束时残留测试 Schema 数为 0，测试数据库已停止。
- 正式 Web 导出、资源压缩和密钥扫描通过。iOS 导出、原生更新配置展开和运行时指纹验证通过。
- EAS 的 Expo Doctor 仍有动态配置识别、微信库新架构资料及 SDK 补丁版本更新提示；这些提示未阻止 48 号正式构建完成。

## 线上 Web 与 API

- Web：[黑洞英语](https://blackholeenglish.com)。
- D1 已按顺序执行 `0011_daily_quota.sql`、`0012_message_moderation.sql`、`0013_message_bottle_replies.sql`。历史留言保持公开。
- API Worker `waikan-api` 版本：`b72b059b-dd90-4e3d-9803-ff9f78bd0732`。
- Web Worker `waikan-web` 版本：`33d99607-7008-46df-a26e-7176615c16a3`。
- 已核对并保留 `DEVELOPER_USER_IDS` Worker secret；白名单与账号信息未写入客户端或仓库。
- 线上冒烟通过：API 就绪、首页资源与发布产物一致、压缩 JavaScript 可读取、隐私政策更新、游客没有审核权限、审核接口拒绝游客、旧留言响应与新回复响应均通过对应严格契约。
- 冒烟创建的临时游客已注销，原令牌再次访问返回 401。Render 旧客户端兼容入口的就绪检查也通过。

## iOS 与 TestFlight

- 应用：`com.contextreader.waikan`，App Store Connect ID `6811309470`。
- 版本：`1.0.0`，构建号 `48`，源码提交 `3f185bf87c7c13c01fe8f3104b4c502dfbfdddfe`。
- [EAS 构建](https://expo.dev/accounts/fang_zhenyu/projects/waikan-reader/builds/6195aafb-3873-4831-8408-5b1680bd2ab8)。
- [TestFlight 上传任务](https://expo.dev/accounts/fang_zhenyu/projects/waikan-reader/submissions/a103c020-90c3-43fe-817d-d61810fddc8e)。
- 更新频道：`production`；运行时指纹：`33edd9aa4a5f6fe2f4ef25fc60e97e91ed9be19a`。
- 云构建状态：`FINISHED`，北京时间 2026-10-05 15:44 完成。
- TestFlight 上传状态：`FINISHED`，北京时间 2026-10-05 15:46 完成；App Store Connect 记录的上传时间为 15:47。
- Apple 处理状态已核验为 `VALID`，内部测试状态为 `IN_BETA_TESTING`，可通过 TestFlight 安装。外部测试状态为 `READY_FOR_BETA_SUBMISSION`，本次没有提交外部测试审核。

首次尝试的 47 号构建因 Windows 指纹工具缺陷在原生编译前失败；回移 Expo 上游路径规范化修复后，本机与 EAS 已计算出相同指纹。附带测试说明的自动提交受到 EAS 套餐限制，本次提交不附加测试说明。没有提交 App Store 正式审核。

需在真机安装 `1.0.0 (48)`，验证开发者账号审核回复以及热更新下载后重启生效；本次未执行真机安装验证。旧安装包没有更新模块，需要先安装本次新包。后续发布命令和回退说明见 [手机版热更新](2026-10-05-eas-update.md)。

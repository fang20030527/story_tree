# 实名留言瓶

## 功能

Expo 的阅读和口语模式均在「我的」前增加「留言瓶」，宽屏同步显示在侧边导航。游客可以浏览所有留言，邮箱或微信登录后的注册账号可以提交反馈。

现有账号没有用户名，因此首次发布时输入 2–24 字的用户名，服务端原子保存到账号并发布留言。用户名规范化后唯一，后续留言使用相同署名。列表公开显示用户名、完整内容和发布时间，自己的留言标注「我」，不展示邮箱、微信身份或内部用户 ID。

留言最多 1,000 字，按最新时间排序；支持刷新、加载历史记录和错误重试。同一草稿遇到网络故障后保留幂等键，避免重复发布。提交失败保留输入内容，发布中锁定按钮。每账号每 10 分钟最多发布 5 条新留言，已发布留言的幂等重放不额外占次数。

## 代码入口

- `app/src/app/(tabs)/message-bottles.tsx`：路由。
- `app/src/features/message-bottles/`：实名表单、公开列表和请求状态。
- `app/src/api/messageBottles.ts`：共享契约 API 客户端。
- `packages/contracts/src/index.ts`：用户名、留言、分页和账号资格 schema。
- `server/src/modules/message-bottles/`：Fastify／Neon 实现和两套后端共用的校验辅助函数。
- `cloudflare/api/src/message-bottles/`：正式 Cloudflare／D1 实现。

接口为 GET／POST `/v1/message-bottles` 和 GET `/v1/message-bottles/profile`。使用既有 Bearer 安装身份；POST 必须提供 `Idempotency-Key`。发布需要注册账号，首次分配用户名与创建留言在同一事务内完成。D1 的最终写入重新校验资格、署名和发布次数，条件未命中时回滚整个 batch；Neon 使用事务锁和账号行锁串行处理发布。

## 发布顺序

正式 Cloudflare 环境先执行 D1 增量迁移 `0008_message_bottles.sql`，再发布 API，最后发布 Web 或更新原生客户端：

```powershell
npm run cloudflare:d1:migrate:api
npm run cloudflare:deploy:api
```

Web 沿用项目已有的 Web 导出与 Cloudflare 发布流程。执行这些生产命令需要现有 Cloudflare 凭据，本任务没有执行生产迁移或部署。

本地 Fastify／Neon 或 Render 环境需要新增 Drizzle 迁移 `0016_huge_storm.sql`，使用项目唯一迁移入口：

```powershell
npm run db:migrate --workspace=@context-reader/server
```

生产 Neon 环境使用已有 `db:migrate:production` 启动流程。新迁移只增加表、字段和索引，不改动历史阅读或口语数据。

## 验证记录

- 提交前完整 `npm run check` 通过，包含全工作区类型检查、测试和 Lint；Cloudflare API 类型检查通过。
- 全量客户端测试通过：109 个测试文件、599 项测试，包含留言导航、发布、分页和较早幂等重放的时间排序。
- 服务端全量测试通过：67 个测试文件、494 项测试，包含 Neon 留言集成测试；契约包 5 个测试文件、61 项测试通过，小程序 9 项测试通过。
- 留言的 D1／SQLite 测试 6 项通过，涵盖实名、游客可读不可写、私密身份不外泄、同键并发重放、用户名不可冒用、稳定分页、并发频率限制、身份失效回滚和实际 Worker 分发。
- Cloudflare 全量测试按项目 30 秒超时运行，18 个测试文件、157 项测试全部通过。
- Lint 通过，保留仓库已有的 24 条客户端 warning；服务端构建、Web 导出和客户端密钥泄漏检查通过。
- 提交前定位并修复本机与数据库时钟差导致的即时任务领取失败：练习、导入和两类翻译使用数据库默认入队时间；导入回归覆盖本机快一分钟，租约边界测试使用数据库时间构造截止时间。修复后的全量检查通过，集成测试仍只创建和清理随机 `app_test_*` Schema。

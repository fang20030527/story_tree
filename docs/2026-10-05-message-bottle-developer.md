# 留言瓶开发者模式

## 使用方式

开发者用自己的邮箱或微信账号正常登录，在「留言瓶」顶部点击「开发者模式」。普通账号和游客没有该入口。审核页按待审核、被举报、已隐藏、全部留言筛选，分页加载，支持通过、隐藏、删除、禁言和解除禁言。

每条留言可保存一条开发者回复，长度为 1–1,000 字，支持修改、删除。回复不会自动公开待审留言；通过审核后，回复跟随原留言公开。待审和隐藏留言的作者仍可看见自己留言下的回复。屏蔽或举报某条留言时，其回复一并不再显示。

发布中按钮锁定，网络失败保留草稿。权限被撤销后，下一次审核请求会拒绝并退出开发者模式；离开栏目或换账号后清空审核数据，迟到的网络响应不能填回旧数据。

## 授权账号

授权唯一依据是服务端 Worker secret `DEVELOPER_USER_IDS`，值为一个或多个已注册用户 UUID，以英文逗号分隔。它不是邮箱白名单，也不是客户端开关；账号注销后重新注册的同名或同邮箱账号不会继承权限。配置前确认登录账号所属者，禁止使用用户提交的显示名作为自动授权依据。

邮箱账号由维护者在 Cloudflare D1 控制台运行下述只读查询，替换示例邮箱，只查询指定账号：

```sql
SELECT users.id, users.kind, users.username
FROM users JOIN email_accounts ON email_accounts.user_id = users.id
WHERE email_accounts.email = 'your-login@example.com'
  AND users.kind = 'registered' AND users.deleted_at IS NULL;
```

确认该行是开发者的现有账号后，从项目根目录运行：

```powershell
npx wrangler secret put DEVELOPER_USER_IDS --config cloudflare/api/wrangler.jsonc
```

在交互输入中粘贴账号 UUID；不要把邮箱、密码、白名单值或后台口令提交到仓库，也不要写进 `EXPO_PUBLIC_` 变量。多个开发者用逗号分隔，不支持通配符。微信账号需要通过已知账号信息核对对应 `users.id`，不要猜测。

撤销部分账号：重新设置 secret，移除对应 ID。关闭全部应用内开发者权限：

```powershell
npx wrangler secret delete DEVELOPER_USER_IDS --config cloudflare/api/wrangler.jsonc
```

这些配置只影响应用内开发者功能；独立网页继续使用 `ADMIN_TOKEN`。白名单默认不配置，代码和迁移不会自动给任何账号提权。

## 上线顺序

1. `npm run cloudflare:d1:migrate:api` 按顺序应用所有待执行迁移，包括 `0011_daily_quota.sql`、`0012_message_moderation.sql` 和本次的 `0013_message_bottle_replies.sql`；已经执行的迁移会跳过。
2. 按上面的步骤核对账号并设置 Worker secret。
3. `npm run cloudflare:deploy:api` 发布 API。
4. 导出、部署 Web，并按原有流程发布原生客户端。

`0013` 只新增回复表；前置审核迁移 `0012` 也保留历史留言的公开状态。线上请求走 Worker + D1，Render 兼容代理透传 `/v1/*`。独立旧 Fastify 服务不提供该审核功能；开发此页面请连接 Worker。

本次迁移、部署及 TestFlight 执行结果见 [发布记录](2026-10-05-message-bottle-release.md)。

## 接口兼容与清理

- 能力：`GET /v1/developer/access` 返回 `{ canModerate }`。
- 审核：`GET /v1/developer/message-bottles?view=pending`，支持 `view=reported|hidden|recent`、`limit`、`cursor`，每页最多 50 条。
- 留言动作：`POST /v1/developer/message-bottles/:id/approve|hide|delete`。
- 禁言：`POST /v1/developer/users/:id/ban|unban`。
- 回复：`PUT /v1/developer/message-bottles/:id/reply`，正文 `{ content }`；删除用同路径的 DELETE。相同内容重复 PUT 不更新时间，重复 DELETE 不产生错误。
- 普通列表及创建显式带 `includeReply=1` 时才返回新增的 `reply`（无回复为 null）和审核状态。原始 DTO、`includeStatus=1` 的 DTO 和账号 profile 保持原样，旧客户端仍能通过严格解析。
- 公开回复不包含开发者账号 ID 或邮箱。内部回复作者与留言均有外键；删除留言、留言作者注销或回复者注销时自动删除回复。

验证使用内存 SQLite 运行全部 D1 迁移，并覆盖 Worker 安装令牌入口、权限撤销、审核、分页、回复幂等、旧响应、可见范围、注销清理及客户端操作。不调用真实 AI，也不自动修改生产数据。

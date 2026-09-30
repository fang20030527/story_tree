# 黑洞英语微信小程序

原生 WXML、WXSS、Page 和微信导航实现，未嵌入原型网页。沿用已经确认的纸色、墨色、朱橙与豆沙粉，四个主页面顶部 Logo 居中；精选卡任何位置进入文章概述，主题和外刊筛选只影响下方文章。

## 启动

在仓库根目录执行：

```powershell
npm install
Copy-Item miniprogram/config.example.json miniprogram/config.local.json
# 编辑 config.local.json 后执行
npm run build --workspace=@context-reader/miniprogram
```

`config.local.json` 配置 `apiOrigin`（无路径的 API origin）和自己的微信小程序 `appid`。它不会提交到 Git。未配置 origin 时，构建器仅尝试读取 `app/.env` 中的 `EXPO_PUBLIC_API_BASE_URL`，不会复制其他变量。示例 origin 是占位值，使用前需要改为自己的服务地址。

用微信开发者工具导入本目录 `miniprogram/`，不要直接导入 `dist/`；`project.config.json` 已将小程序目录设为 `dist/`。未填 AppID 时使用游客工程，可查看页面，但游客模式不能代替正式小程序的真机联网验证。

正式运行需要在小程序后台配置 API 的 HTTPS request 合法域名，以及文章图片、音频使用的合法媒体域名。`urlCheck` 保持开启。开发 API 如为本机 HTTP，在本地配置显式设置 `allowLocalHttp: true`；真机使用手机可访问的局域网地址，正式发布使用 HTTPS。修改配置或源码后重新运行构建。

## 页面与业务

- 外刊：公共目录与正文来自 API，每日精选固定，主题/外刊组合筛选、搜索和加载更多。
- 书架：本机收藏外刊、云端导入文章；概述确认收藏和移除；保留加载失败提示。
- 词库：真实统计，全部/待复习/未到时间，标记掌握。
- 阅读：逐词查释义、加入生词本、全文翻译、原刊音频；实际阅读时长进入当前账号的本机学习日志。
- 练习：智能选词由服务端 FSRS 决定；自定义选词支持词库多选和手动录入；四主题任务轮询、失败主题重试、语境自测与真实答案反馈。
- 导入：URL、粘贴正文、微信文件、相册图片、电脑上传码；上传/处理/预览/确认均使用真实状态。相似文章由用户选择打开已有文章或另存版本。
- 登录：现有邮箱与密码 API；首次登录自动创建账号，密码不保存。匿名云端学习保留明确的 14+ 确认。微信小程序授权登录需要新增服务端专用认证接口，当前入口采用邮箱登录。
- VIP：权益、方案、邀请码入口已制作；支付和兑换没有服务端接口，明确显示未开放，不模拟成功。

书架收藏、最近阅读和阅读时长暂为当前账号的本机记录。云端词库、导入文章和练习随同一邮箱账号同步。临时文件在页面离开后可能失效；返回导入页可查任务状态，已失效的未上传文件需重新选择。

## 开发与验证

`src/api.ts` 使用 `packages/contracts` 的 Zod schema 验证请求响应，凭据由 `wx.getRandomValues` 生成；网络重试持久化并复用幂等键，退出登录清理未确认请求，并阻止迟到的凭据生成或登录响应恢复旧会话。`src/controller.ts` 为 19 个 Page 共用控制器；`src/screen.wxml` 按页面渲染原生内容。构建器提供 URL polyfill，避免微信运行时缺少 URL 导致契约解析失败。业务包只打包一次，当前主包约 595 KiB。

```powershell
npm run typecheck --workspace=@context-reader/miniprogram
npm test --workspace=@context-reader/miniprogram
```

测试运行编译后的 App/Page，验证真实契约解析、错误状态、幂等重试、固定精选导航和日历边界，不调用真实生成服务。当前电脑未安装微信开发者工具，尚未验证其编译器和微信真机；交付时需要使用自己的 AppID 与域名配置完成该项验证。

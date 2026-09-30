# 2026-09-30 品牌前端发布记录

用户授权提交推送远端 main、重新部署 Web，并构建上传支持 iPhone 和 iPad 的 iOS 版本到 TestFlight。此前各版原型保留，独立微信小程序工程已随源码提交。

## Git 与构建来源

- `65974238a2338b8137990d32c93e35a6ae9712bd`：品牌前端、独立小程序工程及生产配置，已推送 main。iOS 构建使用此提交，包含此前已发布功能。
- `fe6e61f7c2e7471a659d18674530a60901714178`：Web 水合修复与回归测试，已推送 main，作为最终 Web 部署来源。修复初始断点、图标字体及跨日期学习日志；原生平台保留实际窗口宽度及字体加载行为。
- 发布记录和正式站点截图另行提交；不包含本地环境配置、密钥或 IPA 文件。

## Web

- 正式站点：<https://blackholeenglish.com/>
- Cloudflare Worker：`waikan-web`
- 最终版本：`9ab7689e-f88d-4e46-8bce-e9f743992ffe`
- 生产导出：32 条静态路由，入口 `entry-7e68291107bdc9b1fefa229b637c5cf7.js`，大入口资源以 gzip 提供。
- 2026-09-30 14:03（北京时间）验证：HTML 200、正确入口脚本 200/gzip、公开外刊目录 200 且符合共享契约、未登录 dashboard 401、原刊音频 Range 206、原刊图片 200。
- 正式浏览器验证：每日精选整卡进入概述，主题筛选仅影响发现列表；首页和直接打开个人页无新增控制台错误，学习日志加载正常。
- 发布截图：`docs/visual-preview/real-app/production-web-home.png`。

## iPhone / iPad TestFlight

- 版本：`1.0.0 (37)`
- Bundle ID：`com.contextreader.waikan`
- [EAS 构建](https://expo.dev/accounts/fang_zhenyu/projects/waikan-reader/builds/1c93af1f-5588-4187-b7ad-caffccda2f7e)：`FINISHED`
- [EAS 上传](https://expo.dev/accounts/fang_zhenyu/projects/waikan-reader/submissions/7038cba9-8a77-4e95-b5ea-952d32689cc8)：`FINISHED`
- App Store Connect：`processingState=VALID`、`internalState=IN_BETA_TESTING`、未过期；内部测试可用。外部测试状态为 `READY_FOR_BETA_SUBMISSION`。
- 已下载检查签名 IPA：设备族 `[1, 2]`，iPhone/iPad 均包含横竖屏；两个品牌字体内容与源文件一致；生产 API 指向 `https://blackholeenglish.com`，未包含本地 LAN 地址或已配置的服务端密钥。

## 检查与边界

- 经 `scripts/test-local.ps1` 完整执行 `npm run check`，退出码 0；本地 PostgreSQL 使用随机隔离测试 Schema。
- 客户端 68 个测试套件、353 项；服务端 54 个测试文件、293 项；共享契约 33 项；小程序 9 项，共 688 项通过。
- 另有 8 项 Cloudflare Web Worker 回归通过；全工作区类型检查和 lint 通过，客户端 25 条警告、0 错误。
- Web、客户端源码及小程序构建产物共 1289 个文件通过服务端密钥泄漏检查。
- iPhone/iPad 实际设备上的完整业务验证尚需测试设备；小程序开发者工具和微信真机验证尚未完成。
- VIP 支付和邀请码兑换接口尚未提供，前端仍明确显示未开放。未执行真实付费生成冒烟。

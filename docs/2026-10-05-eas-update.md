# 手机版热更新（EAS Update）

## 当前配置

- 当前发布范围为 iOS 和 Web，EAS Update 只发布 iOS 更新；Web 继续通过 Cloudflare 部署。
- `expo-updates` 使用 SDK 57 对应版本，更新地址绑定现有项目 `@fang_zhenyu/waikan-reader`。
- `runtimeVersion.policy` 为 `fingerprint`：仅原生指纹相同的安装包接收对应更新。新增原生依赖、修改原生权限或升级 Expo SDK 后，要重新构建安装包。
- 启动时检查并后台下载更新，不等待下载才打开页面；下载完成后，下次完整启动 App 时生效。断网时使用已缓存的版本或安装包内置版本，不强制中断阅读。
- `preview` 与 `production` 使用独立更新频道。两个频道均读取 EAS 的 `production` 环境并连接正式 API；预览频道用于验证客户端更新，不是独立测试数据库。
- 更新脚本固定 EAS CLI 24.10.0，显式指定 iOS、频道和环境，避免误发到另一个频道。

接入配置本身不会发起云构建或上传热更新，也不会让之前安装的旧包自动获得更新能力。首次需要安装一个包含 `expo-updates` 的新包。

## 正式环境

预览构建、正式构建和热更新统一从 EAS 的 `production` 环境读取以下三个公开配置。已移除 `eas.json` 中重复的变量值，避免构建和更新连接不同服务器：

| 变量 | 值 |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://blackholeenglish.com` |
| `EXPO_PUBLIC_EDITORIAL_AUDIO_ORIGIN` | `https://blackholeenglish.com` |
| `EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN` | `https://blackholeenglish.com/v1/editorial/images` |

以后如启用微信原生登录，微信 AppID、Universal Link 和包标识也必须在构建与更新时保持一致；这类配置会影响原生指纹。数据库、AI、微信 AppSecret 和后台口令仍只保存在服务端，不应放进任何 `EXPO_PUBLIC_` 变量。

## 首次安装

1. 完成客户端验证，并先部署本次客户端依赖的服务端变更。留言瓶开发者模式需要先执行 D1 迁移 `0013` 并发布新版 Worker，详见 [留言瓶开发者模式](2026-10-05-message-bottle-developer.md)。
2. 在 `app` 目录执行一次 iOS 构建。可将留言瓶开发者模式和热更新能力包含在同一个包中：

   ```powershell
   npx eas-cli@24.10.0 build --platform ios --profile production --auto-submit
   ```

3. 该命令使用现有 `submit.production` 配置，在构建成功后上传 TestFlight。等 Apple 处理完成后安装，并验证登录、留言瓶与阅读流程。正式上架沿用现有 App Store 发布流程。构建命令会使用 EAS Build 额度；仅配置不会。

需要独立预览包时，可改用 `--profile preview`。该包使用 `preview` 更新频道，iOS 内部分发需要事先登记设备，额外云构建也会使用构建额度。

## 后续发布

以下命令从仓库根目录运行；会上传并发布当前代码，应在验证完成后执行。

```powershell
# 发布到已安装的 preview 包
npm run update:preview --workspace=app -- --message "说明本次更新"

# 发布到已安装的 production 包
npm run update:production --workspace=app -- --message "说明本次更新"
```

在对应频道、相同原生指纹的安装包上，启动并联网等待下载，然后完整关闭并重新打开 App，确认新内容和原有流程正常。旧包没有更新模块、频道不匹配或原生指纹变化时，不会接收此次更新；不要手改指纹来绕过兼容性要求。

命令打包上传 JavaScript 和资源，不创建新的原生安装包，因此不使用 EAS Build 构建额度；更新下载仍计入 EAS Update 的活跃安装、带宽及存储额度。可在 Expo 账号设置里查看实际套餐与用量。

## 回退

在 Expo 项目的 Updates 页面核对频道、原生版本和更新记录。若某次更新异常，使用 EAS CLI 的 `update:republish` 重新发布同一原生版本的已验证更新；首个更新没有可用前版时，可使用 `update:roll-back-to-embedded` 回到安装包内置版本。执行前先看相应命令的 `--help`，选择正确频道和原生版本，再在设备上验证。保留 SDK 默认错误恢复机制。

## 验证与隐私

接入验证应包含 Expo 配置解析、iOS 原生配置展开、正式构建与更新环境的指纹一致性、iOS 导出、客户端类型检查、测试和 lint。没有实际构建并安装新包前，无法把手机端更新下载与重启生效标记为已验证。

2026-10-05 本地验证：客户端 119 个测试套件、670 个测试通过，类型检查通过，lint 无错误（24 条既有告警）；iOS 导出通过。导出的 Hermes 文件约 153 MB，这是本地产物大小，不能直接当作压缩或差分后的实际下载流量；发布后应结合 EAS Update 用量页观察流量。

已通过 EAS CLI 核对两个构建配置的频道、环境、更新地址和指纹策略；iOS 原生配置确认启用启动检查、零等待和指纹文件。使用正式构建环境与更新环境计算的原生指纹一致。对 iOS 导出的 222 个文件及 6 项本地已配置服务端密钥完成泄漏检查，并确认产物包含正确的正式 API 域名。上述接入验证未执行云构建、提交安装包或上传热更新；实际发布另行记录，真机端效果需安装新包后验证。

隐私政策已补充 Expo 更新请求涉及的 IP 地址、随机安装标识、平台、兼容版本与更新运行信息。应用不向更新服务提供账号登录凭据或学习正文。

## Windows 构建指纹修复

首次云构建发现 `@expo/fingerprint@0.20.12` 在 Windows npm workspaces 中没有先规范化 `..\\node_modules` 路径，错误地把 204 个构建工具文件计入指纹，导致本机与 EAS macOS 的运行时不一致。仓库的 `patches/@expo+fingerprint+0.20.12.patch` 回移 [Expo 上游修复](https://github.com/expo/expo/pull/46816)，通过现有 `postinstall` 自动应用。只统一路径分隔符，保留依赖、原生配置和本地配置插件的兼容性校验。

修复后本机指纹与失败构建日志记录的云端指纹完全相同；生成的 `ios` 目录只有空哈希，不影响结果。以后升级 SDK 或 `@expo/fingerprint` 时，需核对上游是否已包含此修复，再移除补丁并重新比较构建与更新指纹。

参考：[SDK 57 expo-updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/)、[EAS Update 接入](https://docs.expo.dev/eas-update/getting-started/)、[EAS 环境变量](https://docs.expo.dev/eas/environment-variables/usage/)、[运行时兼容规则](https://docs.expo.dev/eas-update/runtime-versions/)。

# Build 35 真机连接检测结论

检测时间：2026-09-26 18:00:28（北京时间），用户提供 iOS build 35 的报告及检测页截图。此前排查记录见 [Build 32 后续联网排查](2026-09-26-build32-editorial-loading.md)。

## 真机证据

| 检查 | 结果 | 能支持的判断 |
| --- | --- | --- |
| 本机登录信息读取 | `STORED`，12 毫秒 | 本次凭据读取没有阻塞；不代表令牌已通过服务端验证 |
| React Native 访问 Apple 对照网页 | 200，151 毫秒 | 当前客户端可以访问其他公开 HTTPS 网站 |
| Expo fetch 访问同一对照网页 | 200，182 毫秒 | 备用连接方式也可以联网 |
| 两种 fetch 访问业务入口 | 四类请求均约 12 秒超时，没有 HTTP 状态 | 故障发生在取得响应头之前；还未进入业务错误或响应正文处理 |
| 系统联网状态 | `satisfied`，Wi-Fi，非受限连接 | 系统没有报告当前网络不可用 |
| 独立 URLSession 访问 Apple 对照网页 | 200，191 毫秒，DNS、连接、TLS 都有成功度量 | 原生诊断模块正常运行，独立系统请求可以联网 |
| 独立 URLSession 访问业务入口 | 10,004 毫秒，`NSURLErrorDomain / -1001`，`stage=unknown` | 独立系统请求也发生超时，问题不局限于 JavaScript fetch 的实现 |

业务入口的原生度量中，DNS、连接、TLS 的开始和完成标记均为 `false`。这表示 URLSession 没有提供这些阶段的时间戳，不能直接推导出“DNS 一定没有执行”或“DNS 污染已经证实”。`proxy=false` 同样不能排除系统级网络扩展或透明网络处理。

本次报告的 `recentFailures=[]` 仅代表内存中没有保存近期业务失败记录，不推翻检测请求的超时结果。

## 本机与云端核查

- 生产构建配置的 API、录音和图片均使用 `waikan-web.zhenyufang162.workers.dev`，与原生模块允许检测的入口一致。不能由开发用 `app/.env` 的 localhost 配置推断生产包使用了本地地址。
- 从开发电脑执行与客户端相同的公开探测，目录取得 200 且通过共享契约校验，空身份登记请求取得 400 / `VALIDATION_ERROR`，两字节录音范围请求取得 206 / `audio/mpeg`，无令牌 dashboard 请求取得 401 / `UNAUTHORIZED`。四项各约 1.0–1.1 秒。
- 上述请求没有创建身份、修改词库或调用 AI。空身份登记请求在契约校验阶段被拒绝。
- 开发电脑系统 DNS 返回 `198.18.0.112`，该地址位于基准测试保留网段，说明电脑网络存在本地解析或转发处理。即使 curl 禁用了显式代理，也不能把电脑成功当作手机网络的直连证据。
- Google 公共 DNS 的 HTTPS 查询同时取得该入口的公开 A 和 AAAA 记录。这只证明公共解析器能解析，不代表手机实际使用的解析器或 IPv6 路径正常。
- 初始 Cloudflare 只读查询确认 `waikan-web` 仍绑定 `waikan-api`、`waikan-audio` 和静态资源；当时部署创建于 2026-09-25 14:05:48 UTC，账户 Workers 自定义域名列表为空。
- 初始凭据可见的已启用 Zone 是 `papergirlfriend.store`。查询 DNS 记录和 Zone Worker routes 均取得 403；后续新域名接入使用已登录控制台和现有 Workers Domains 权限，没有扩大凭据权限。

## 判断与下一步验证

当前证据将优先排查范围收敛到手机到业务域名的解析、路由和系统连接过程。按优先级检验以下三种假设：

1. **该域名的解析或网络路径异常。** 为同一个 Web Worker 增加自定义域名，在同一手机、同一网络、相同请求实现下对照。如果新入口成功而旧入口继续超时，可以把异常进一步定位到入口域名或其连接路径。
2. **业务入口的 IPv4／IPv6 或边缘连接异常。** 若自定义域名仍失败，需要获得设备侧独立解析和连接证据，再分别核查地址族；现有 URLSession 时间戳不足以区分。
3. **入口服务间歇性故障。** 将真机尝试时间与 Cloudflare 请求记录对应。电脑本次四项探测成功降低了这一假设的优先级，但不能排除局部边缘或间歇性故障。

用户已选择专用域名 `blackholeenglish.com`，并提供 Name.com 的域名管理页面。以下接入工作已完成或正在验证；不使用其他项目的 `papergirlfriend.store`。

选定后需要同步处理：

- API、录音、图片的三个生产公开 origin；图片保留 `/v1/editorial/images` 路径。
- Web Worker 的正式与切换配置，明确保留 `workers_dev=true`，避免添加 routes 后隐式关闭旧安装包的入口。
- 如用于正式 Web 访问，重新导出包含新 API origin 的静态客户端，避免旧包内固定入口造成跨域。
- 原生诊断模块的固定 origin 白名单，允许选定的新入口，并保留旧入口。当前 build 35 的原生模块只允许旧域名，改配置后仍需要新原生构建才能检测新入口。
- 新入口的目录契约、空身份请求、录音 Range 和身份验证，再进行真机验收。

同一个 Worker 的新入口继续使用现有 Service Bindings 和 D1 数据，不需要迁移账号或词库。自定义域名是可检验的修复方向，尚未证明能解决这台设备的故障。本环境不能执行该 iPhone 的 URLSession，仍需新入口的真机验收。

## 专用域名接入进展

- Name.com 管理页面确认域名已在用户账号中；原 DNS 管理页面无自定义记录，公开 DNS 指向 `91.195.240.94` 的停放页。
- 使用已登录的 Cloudflare 控制台添加域名并选择 Free 方案，Zone ID 为 `48dd2806d01983b7c3bd860c7a9badbf`。现有 API 凭据添加 Zone 返回 403，所以使用控制台完成，没有扩展或创建凭据。
- Cloudflare 扫描导入了根域名、`www` 和通配符三个停放 A 记录。根域名停放记录已由控制台移除；随后 Workers Domains API 确认 `blackholeenglish.com` 已绑定现有 `waikan-web / production`。该步骤不部署或替换 API、任务处理器及数据库。
- 已修改两个 Web Wrangler 配置，声明根域名 Custom Domain，并明确保留 `workers_dev=true`。旧安装包继续使用旧入口。
- EAS production 的 API、录音、图片地址已改为专用域名；Swift 原生检测白名单同时允许专用域名与旧入口。新的原生检测仍需 iOS 新构建验证。
- 全工作区 `npm run check` 通过：客户端 69 套件 / 386 项，服务端 54 文件 / 292 项，契约 1 文件 / 33 项，共 711 项；类型检查和 lint 无错误，保留原有 24 条客户端警告。
- Name.com 的编辑按钮在内置浏览器中，经语义点击、可见按钮点击及刷新后仍未打开编辑表单。已请求用户在自己的浏览器保存域名服务器为仅 `eric.ns.cloudflare.com` 和 `shubhi.ns.cloudflare.com`。公开 DS 查询没有记录，因此本轮没有改动 DNSSEC。
- 用户保存后，Verisign 注册局 RDAP 确认只公布 `ERIC.NS.CLOUDFLARE.COM` 和 `SHUBHI.NS.CLOUDFLARE.COM`，Cloudflare Zone 已为 `active`；公共 DNS 已返回 Cloudflare A 记录。
- Cloudflare 证书页面确认根域名与一级通配符证书均为 Active。接入初期，电脑普通请求返回旧 `Parking/1.0` 服务，连使用 curl 的 `--resolve` 也未到达新入口，与公共 DNS 不一致。通过电脑已有 HTTP 代理，以公共 A 地址建立 CONNECT 并保留域名 SNI 和完整证书校验，新入口取得正常 Cloudflare HTTPS 响应；期间仍有间歇性 TLS 错误。最终普通系统解析路径也已恢复，根页面取得 200，以下目录、登录校验、录音、身份验证与图片五项均通过，未更改电脑代理或网络设置。
- 生产 Web 重新导出、复制外刊资源并压缩入口 JS，Wrangler 发布成功，最终版本为 `634a2706-9e08-4191-933c-6ec2f606a8d4`。静态资源配置改为先执行 Worker，使旧网站 GET/HEAD 链接能跳转到专用域名并保留路径与查询；`/v1/*` 和电脑上传接口仍保留旧入口，避免旧 App 的身份令牌跟随重定向。相关 Web Worker 8 项测试通过；线上旧网站取得正确 308，旧 App 目录仍为 200 且无跳转。
- 新入口四项公开验证全部通过：目录 200 且符合共享契约；空身份登记 400 / `VALIDATION_ERROR`；录音两字节 Range 206 / `audio/mpeg`；无令牌 dashboard 401 / `UNAUTHORIZED`。各项约 1.1–1.3 秒，没有创建身份或修改用户数据。
- 最终使用普通 Node fetch 和系统解析重复验证上述四项，并加入实际 EPUB 图片 HEAD，五项全部通过（图片 200 / `image/webp`）；约 1.1–1.2 秒，TLS 校验保持启用。
- iOS 本地导出成功，Hermes 字节码包含新 API 和图片 origin；客户端密钥检查验证 756 个文件与 2 个已配置服务端密钥，没有发现泄漏。Web Worker dry-run 通过。
- 线上主 JS 入口取得 200，`Content-Encoding: gzip` 和 JavaScript 类型正确；新域名下实际 EPUB 图片取得 200 / `image/webp`。目录当前为零条远程文章，外刊资源仍由客户端内置目录与 214 份发布资源提供。
- EAS iOS production build 36 已完成，构建 ID 为 `747cba27-4add-4bab-a6d6-04797610b48d`。IPA 校验确认 build 36、bundle ID `com.contextreader.waikan`、JS 新 API／图片 origin，以及原生诊断模块的新旧固定 origin 均存在；原生编译日志未发现诊断模块错误。
- TestFlight 提交 ID 为 `f106f0cc-848e-4146-be4b-aecd0bb35872`。App Store Connect 已确认 build 36 的 `processingState=VALID`、`internalState=IN_BETA_TESTING`，内部测试可安装；没有提交 App Store 正式审核。真机连接修复仍需用户在 iPhone 更新至 36 后重新运行连接检测。

部署和客户端产物已完成，电脑验证通过不等同于问题手机已修复。保留 build 35 报告与新报告作同设备、同网络对照，仍以新版本的真机结果为准。

参考：[Cloudflare 的生产入口建议](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Cloudflare 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[Apple 超时错误定义](https://developer.apple.com/documentation/foundation/nsurlerrortimedout-c.enum.case)。

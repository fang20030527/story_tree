# 阅读／口语功能：现有 API 可行性核查

核查日期：2026-09-30；接入选择更新：2026-10-01。依据已确认原型、当前 Expo 前端、服务端源码及服务商官方文档。本次只核查与记录，没有新增后端代码、执行数据库迁移或调用收费模型。

后续实施更新（2026-10-01）：已有字幕的口语 API、本地／R2 存储适配和客户端账号同步已接入，三部完整影片的本地 HTTP 测试通过。下文保留核查当时的状态；当前实现与验证范围见 [口语后端说明](speaking-backend.md) 和 [电影实测报告](speaking-movie-test.md)。自动字幕、真实支付及 YouTube 客户端嵌入尚未开放。

## 结论

核心跟读功能可以实现。字幕翻译和语境查词已有接口；播放、录音、复读和字幕交互主要由客户端完成。云端素材、文件、字幕版本、笔记和学习记录需要新增业务接口，但没有发现必须更换 AI 服务商才能实现的障碍。

当前重点缺口是自动字幕、长期音视频存储、真实支付。YouTube 的任意字幕获取、离线下载、任意倍率，以及把其公开视频播放作为付费权限，受到官方接口与平台规则限制。TED 商业素材使用需要授权。它们需要在写后端前明确接入边界。

AI 发音评分与纠错按用户最新要求不在本版范围内。

## 已确认的模型与 R2 存储建议

2026-10-01，用户确认自动字幕先使用 `gemini-2.5-flash-lite`，沿用服务器已有 `EVOLINK_API_KEY`。这项选择用于后续音频适配，尚未变更运行配置或调用模型。EvoLink 明确列出该模型的音频输入能力。[模型说明](https://evolink.ai/zh/gemini-2-5-flash-lite)

Cloudflare R2 可以作为音视频长期存储。建议将原始音视频、转写用音轨、跟读录音及导出的文件保存在 R2；素材归属、对象键、字幕版本、笔记和练习记录继续保存在 Neon。R2 支持 S3 对象接口和 `GetObject` 的 Range 读取，可用于播放器按范围加载媒体。[S3 兼容能力](https://developers.cloudflare.com/r2/api/s3/api/)

个人文件建议存入私有桶，由后端验证账号权限并签发短期上传／播放 URL，客户端可直接传输文件。Web 直传需配置桶 CORS；上传完成后由后端核实对象大小、类型和归属，再创建字幕任务。R2 的访问凭证单独配置在服务端，与 EvoLink key 分开使用。[预签名 URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [CORS](https://developers.cloudflare.com/r2/buckets/cors/)

转写任务从 R2 读取原文件，按网关限制提取／压缩／分块音轨，再通过 Gemini 原生接口调用 Flash-Lite。可以评估内联音频方式，或生成时效受控的读取地址；EvoLink 对带签名参数的媒体 URL 的兼容性仍需实测。R2 存储能力本身不会完成转码、识别或时间对齐，相关处理在后台任务完成。

R2 Standard 当前存储单价为 $0.015／GB-month，包含每月 10 GB-month 免费额度；直接从 R2 传出的流量免费，读写操作超出免费额度仍计费。建议对频繁播放的素材使用 Standard。[官方价格](https://developers.cloudflare.com/r2/pricing/)

R2 方案已核查可行，当前尚未创建桶、配置凭证或接入上传／播放接口。

## 会员支付渠道建议

2026-10-01 核查：微信支付和支付宝均提供正式的网页／App 支付接入能力，可以作为真实会员购买渠道。需先完成各自的商户／应用审核，并开通对应支付产品；微信 App 支付还需要商户号与开放平台移动应用 APPID 绑定。[微信支付接入指引](https://pay.wechatpay.cn/static/applyment_guide/applyment_index.shtml) · [微信 App 支付申请](https://pay.wechatpay.cn/doc/v3/merchant/4013070174) · [支付宝网页／移动应用接入](https://open.alipay.com/module/webApp)

推荐按发行渠道配置购买入口：

| 发行端 | 购买渠道建议 |
| --- | --- |
| 独立 Web／H5 | 微信与支付宝，按浏览器环境选择扫码、H5 或对应网页支付产品 |
| 微信小程序 | 数字会员使用 `wx.requestVirtualPayment`；Android／鸿蒙／Windows 路由至微信支付，符合条件的 iOS 路由至 Apple 支付 |
| 允许第三方支付的 Android 分发渠道 | 微信 App 支付与支付宝 App 支付；具体应用商店规则单独核实 |
| 中国区 App Store 的 iOS App | 数字会员在 App 内购买以苹果 IAP 为默认方案；外部购买例外需符合地区与授权条件 |
| Google Play 分发 | 默认接 Play Billing；支持地区的替代支付须加入对应项目并满足要求 |

本产品的会员解锁阅读、AI 练习和跟读功能，属于数字内容／功能。苹果规则 3.1.1 对 App 内解锁规定使用 IAP，不能仅因产品包含阅读功能，就认定适用阅读器 App 的例外。规则 3.1.3(b) 允许多平台服务访问在其他平台已购买的权益，但要求相关项目同时在 App 内通过 IAP 提供；购买入口和引导也要符合对应店面规则。[Apple 审核指南](https://developer.apple.com/cn/app-store/review/guidelines/) · [Google Play 付款政策](https://support.google.com/googleplay/android-developer/answer/9858738?hl=zh-Hans)

2026-10-01 核查苹果佣金：自 2026-03-15 起，中国大陆 App Store 的 iOS／iPadOS 标准 IAP 与付费 App 佣金为 25%；App Store Small Business Program、Mini Apps Partner Program 项下符合条件的 IAP，以及第一年后的自动续费订阅，佣金为 12%。中国大陆费率以该地区公告为准，不直接套用通用介绍页中的 30%／15%。[苹果中国大陆调整公告](https://developer.apple.com/cn/news/?id=dadukodv)

小型企业优惠需要申请并获批，收入条件按开发者及关联账户合计核算：上一日历年及本年度的 App Store 收入不超过 100 万美元，收入指扣除苹果佣金及某些税费、调整后的净销售额。本产品当前是单次购买、不自动续费，手动续购不能直接套用「自动续费订阅满一年」的降佣条件。[小型企业计划资格与申请](https://developer.apple.com/cn/app-store/small-business-program/)

以 128 元会员作仅扣佣金的预算示例：12% 为 15.36 元佣金、余 112.64 元；25% 为 32 元佣金、余 96 元。这是价格与费率的简单测算，实际结算还需按对应税费、退款及平台账单核对；最新确认的渠道价格见下文。微信小程序 iOS 的现行 12% 费率另见下文。

后端可以统一套餐、订单、退款状态和账号会员权益，分别适配微信、支付宝及平台内购。支付成功以服务端验签通知或主动查单为依据，校验订单金额及商户／应用信息，幂等更新权益；客户端返回值用于展示与查询。按既有原型保留单次购买、不自动续费的方案，自动扣款需要另行签约与设计。

当前客户端的 `expo-native-wechat` 已暴露 `requestPayment`，可作为允许微信支付的平台的客户端接入基础；现有微信登录服务尚未实现支付下单、通知或查单。支付宝和苹果内购也尚未接入。已确认的分渠道价格展示见下文，当前没有创建商户应用或开通任何支付产品。

### 微信小程序的数字会员购买

2026-10-01 核查微信最新官方文档：解锁功能、订阅内容等虚拟商品需接入小程序虚拟支付。本产品的阅读／口语 VIP 按该渠道接入，客户端调用 `wx.requestVirtualPayment`。2026-02-27 的官方公告已要求相关业务于 4 月 1 日前在全终端接入；普通商品的小程序支付流程不能直接作为这类会员的接入依据。[虚拟支付接入指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html) · [官方更新公告](https://mp.weixin.qq.com/cgi-bin/announce?action=getannouncement&announce_id=11772091560sL6TW&lang=zh_CN)

同一虚拟支付接口根据设备路由：Android、鸿蒙、Windows 使用微信支付，iOS 使用 Apple 支付，均可在小程序内完成购买。iOS 用户需满足 iOS 15 及以上、微信 8.0.68 及以上、中国大陆 App Store 账户，最低支付金额为 1 元；开发者需额外配置小程序简称并开通对应能力。小程序的 Apple 支付不支持沙箱，只支持现网。该规则与上表中独立 iOS App 的 IAP 接入分别适用。[设备路由与 iOS 条件](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)

微信团队《虚拟支付业务运营指南》进一步明确：在线教育、题库练习、内容处理工具等典型虚拟服务，小程序须全终端接入虚拟支付，不得引导至 App、公众号、H5、个人号或网站完成支付。对本产品的阅读／口语数字会员，不能在 iOS 小程序内强制改用普通微信支付，也不能把「引导去网页付款」作为规避该渠道的实现方案。仅包含管控虚拟类目的小程序，平台还会关闭非 iOS 系统的普通微信支付能力；Android 端的微信收款同样需通过虚拟支付接口。实际实物或线下交易按相应类目与支付产品处理，不能把数字会员改名后当作这类商品。[官方虚拟支付业务运营指南](https://developers.weixin.qq.com/community/minihome/doc/00002cf077cd4810fee42f4b865c01)

独立官网／H5 可另行接入网页微信支付，并由用户在手机浏览器使用；这是单独的发行与购买渠道，小程序内的外部支付引导仍受上述规则约束。[微信 H5 支付产品](https://pay.wechatpay.cn/doc/v3/merchant/4012791832)

已认证且主体资料完整的企业、事业单位、个体工商户小程序可在后台申请开通虚拟支付。个人主体也有专门入口，目前要求服务类目含「工具」、完成认证与备案，月支付限额为 10 万元；是否适合本产品仍取决于实际服务类目及平台审核，不能为开通支付随意选择类目。[企业／个体户开通条件](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html) · [个人主体条件](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)

官方当前费率表中，工具等及其他类目的主动支付在 Android／鸿蒙／Windows 为 1%，iOS 为 12%（Apple 佣金）。微短剧、网络小说及自动续费另有费率；本产品应在类目审核后确认实际费率，不把优惠费率作为永久定价条件。公告中的早期 iOS 15% 费率已与当前费率页不同，后续预算以现行费率及开通协议为准。[当前技术服务费](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/devplan.html)

后续实现需新增小程序登录态与账号绑定、服务端支付签名、订单查询、发货通知及退款处理。虚拟支付的 `OfferID`、`AppKey` 由小程序后台提供，密钥只保存在服务端，与 EvoLink key 分开；会员权益可与现有 Neon 账号体系共用。权益开通以可信平台通知及查单为依据，并校验订单、商品、金额和用户，重复通知只开通一次。当前 Expo 客户端不是微信小程序，原生 `requestPayment` 也不能替代小程序 API；若增加小程序发行端，还需单独适配客户端。当前仅核查可行性，尚未创建小程序或开通支付。[虚拟支付接口](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)

## 已确认的分渠道定价

2026-10-01，用户确认保留网页端现价，并上调苹果支付渠道的会员价格：

| 套餐 | 网页端 | 苹果端 | 有效期 |
| --- | --- | --- | --- |
| 月度会员 | ¥19 | ¥22 | 30 天 |
| 年度会员 | ¥128 | ¥148 | 365 天 |
| 永久会员 | ¥198 | ¥228 | 长期有效 |

两端权益一致，仍为单次购买、不自动续费。苹果端约比网页端高 15%；Android 当前保留原价。前端根据发行端选择价格，iPhone 浏览器属于 Web，不能仅凭设备型号使用苹果价。苹果 App 只展示其自身购买渠道的价格。

这组价格已配置到真实 Expo 前端，套餐卡片、所选金额、每日均价与订阅说明统一读取渠道价格。后续接入真实交易时，网页订单价格由服务端套餐目录决定，苹果 IAP 展示与支付价格以 StoreKit 返回的商品信息为准，小程序道具价格与对应支付渠道一致；服务端验证渠道及支付结果，不采用客户端提交的价格。当前没有配置 App Store 商品、小程序道具或开通真实购买。

## 逐项结果

| 功能 | 当前项目支持情况 | 是否存在 API 能力缺口／下一步 |
| --- | --- | --- |
| 阅读／口语切换、对应导航 | 已有真实前端，选择在设备保存 | 无第三方 API 依赖；跨设备同步时增加用户偏好字段 |
| 原音播放、上下句、变速、逐句／AB 复读 | 已接 Expo Audio／Video | 自有及用户导入的媒体可继续使用；外部嵌入播放器需按其能力适配 |
| 字幕显示、搜索、遮挡、自动滚动、分段、跳过字幕空白 | 已有前端与时间轴逻辑 | 不需要识别 API；前提是具有有效的字幕时间轴 |
| 录音、回放、重录 | 已接媒体 SDK，录音存本机 | 不需要 AI API；云同步录音才需要上传与存储，原生端仍需真机联调 |
| 已有 SRT／VTT 导入与逐句校正 | 已有真实前端 | 可以直接做；服务端保存字幕及版本时新增业务接口 |
| 无字幕音视频自动生成字幕 | 当前不可用，AI provider 没有音频输入与转写方法 | 已确认先接 EvoLink Gemini 2.5 Flash-Lite，使用现有 key；需要音频处理、适配、任务队列及时间轴实测 |
| 字幕中文翻译 | 已有 `POST /v1/sentence-translations` | 可复用；整份字幕建议增加批处理、缓存和失败重试，避免逐句重复调用 |
| 字幕内语境查词 | 已有 `POST /v1/word-translations`；前端已有离线词典 | 可复用，传入单词和所在句；不依赖阅读练习 ID |
| AI 台词讲解 | 当前只有内置素材配套注释 | 当前文字模型可承担释义、表达、句法及停顿建议；增加结构化生成方法与业务接口即可，效果需验收 |
| 平台素材库、个人文件、收藏、笔记、练习记录 | 当前口语数据按账号保存在设备 | 数据库可保存元数据及记录；新增口语业务接口与账户权限，没有额外 AI 服务需求 |
| 云端音视频、可下载的自有素材 | 现有文章导入不是长期媒体服务 | R2 已核查可行；新增私有桶上传／读取接口后可承接音视频，不沿用现有文章导入流程 |
| PDF 台词本 | 尚未接入 | 可由前端或服务端 PDF 库生成，不要求新增 AI 服务；需实现中文字体和排版 |
| App 内 YouTube | 尚未接入，规划中 | 官方嵌入播放可做；不能承诺任意视频字幕、无级变速、离线或付费播放权限，见下文 |
| TED 演讲变速与素材 | 尚未接入，规划中 | 授权媒体使用现有播放器可变速；全量内容、字幕和商业使用权限不能由现有接口保证 |
| VIP 购买、会员到期与兑换 | 当前购买和兑换禁用，无会员／支付后端 | 微信与支付宝已核查为可用候选；购买入口按发行平台规则配置，会员和兑换码由后端统一管理 |

## 自动字幕：同一服务商有候选能力，当前调用方式不够

当前 `EvolinkClient` 调用 `/v1/chat/completions`，输入类型只定义文字和图片；`AiProvider` 只有练习生成、校验、翻译、查词、文章 OCR。按当前代码，上传音频后不能直接获得字幕。

EvoLink 的 Gemini 原生接口 `/v1beta/models/{model}:generateContent` 明确支持音频输入，文档给出了音频 URL 示例，同时定义了 `inlineData`。因此可以评估继续使用现有 EvoLink 服务商，新增音频适配，而不是直接认定必须换服务商。[EvoLink Gemini 原生接口](https://evolink.ai/docs/en/api-manual/language-series/gemini/native-api/native-api-reference.json)

该网关文档目前列出的文件输入限制为：音频 MP3 最大 10 MB，建议不超过 10 分钟；视频 MP4 最大 50 MB，建议不超过 180 秒。音频的公开 URL 路径有格式要求；不能把 Google 直连 API 的文件上传能力和限额直接套到 EvoLink。前端允许的 100 MB 音视频需要提取／转换音轨、按需要分块，再合并时间轴。[同一接口的 FilePart 定义](https://evolink.ai/docs/en/api-manual/language-series/gemini/native-api/native-api-reference.json)

Google 官方说明 Gemini 可转写并输出分段时间戳，但这只能作为模型能力依据，不能证明 EvoLink 当前账号已经开放相同请求方式，或时间戳一定满足跟读要求。本次读取的 EvoLink 官方目录没有发现独立的专用语音识别／强制时间对齐端点。[Google 音频理解与转写](https://ai.google.dev/gemini-api/docs/audio) · [EvoLink 官方接口目录](https://evolink.ai/docs/llms.txt)

后端实现前应先用短音频、长演讲、背景音乐、双人对话四类样本验证漏句、误识别、起止时间偏差和分块拼接。返回值需要同时包含每句 `startMs`、`endMs` 和原文；用户校正入口保留。若候选模型的时间轴不达标，再接专用语音识别／时间对齐服务。文字模型只能给表达或停顿建议，不能靠文本评价用户实际发音。

## 文件存储：现有两套上传能力都不能直接充当口语素材库

项目文章导入契约的单资产上限为 10 MiB、批次 30 MiB，MIME 列表面向文字、文档、图片，没有音视频类型。虽然列表包括 `application/octet-stream`，也不能绕过后续文章提取流程，把音视频当成文章处理。临时上传资产有清理周期。

文章 DTO 已支持外部视频引用；外刊也有音频读取服务。两者不等于已有私人音视频上传、字幕转写及长期存储接口。

EvoLink 已查阅的流式与 URL 上传文档目前只列 JPEG、PNG、GIF、WebP 图片，且文件 72 小时后过期，不能直接用于长期保留口语音视频。[流式上传](https://evolink.ai/docs/en/api-manual/file-series/upload-stream.json) · [URL 上传](https://evolink.ai/docs/en/api-manual/file-series/upload-url.json)

Neon 继续保存素材信息、字幕、笔记、记录、权限与会员数据即可。音视频需增加对象存储或具备持久磁盘的媒体服务。当前本机文件导入和录音回放不受云存储缺口影响。

## YouTube：可嵌入，但不能沿用所有自有媒体能力

2026-10-01 追加核查现有配置：`EVOLINK_API_KEY` 与业务 API／数据库配置已存在，没有配置 YouTube Data API、Google Gemini 或 R2 凭证。本次只读取变量名及是否非空，没有输出变量值、变更 `.env` 或调用收费模型。当前口语代码尚未接入 YouTube 播放器。

视频嵌入本身使用 IFrame Player API，不要求新增 YouTube API key；字幕由用户提供时，可新增 YouTube 播放器适配、复用跟读时间轴及现有翻译／查词接口。它仍需代码接入与运行验证，配置存在不等于这条功能链已经可用。原生 App 还需要适配嵌入容器；视频仍由 YouTube 加载，是否允许嵌入及用户网络会影响实际可用性。[IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)

Google 官方 Gemini API 已文档化直接输入公开 YouTube URL 的视频理解能力；但这不能作为 EvoLink 网关支持同一输入的证明。当前 EvoLink Gemini 原生文档没有列出 YouTube URL，`FilePart.fileData.fileUri` 要求可公开读取且地址应以匹配 MIME 的文件扩展名结尾。现有 provider 仍只调用 Chat Completions 的文字／图片输入。因此，「粘贴任意 YouTube 链接自动生成跟读字幕」不能直接凭现有 key 宣布可用；先验证网关的 YouTube URL 支持及逐句时间轴质量，再决定是否增加 Google 直连凭证。EvoLink key 与 Google API key 不可互换。[Google YouTube URL 输入](https://ai.google.dev/gemini-api/docs/video-understanding#pass-youtube-urls) · [EvoLink FilePart 定义](https://evolink.ai/docs/en/api-manual/language-series/gemini/native-api/native-api-reference.json)

- 官方 IFrame API 能播放、暂停、定位和设置支持的倍率。可用倍率须读取 `getAvailablePlaybackRates()`，请求任意小数倍率可能被调整；不能承诺「无级变速」。逐句复读需要结合字幕和实际定位效果适配，不能承诺与本地媒体相同的边界精度。[播放器接口](https://developers.google.com/youtube/iframe_api_reference)
- 官方字幕下载要求用户有该视频的编辑权限，普通 API key 无法下载任意公开视频字幕。观看页面显示字幕，不代表服务端能合法地通过官方接口获取那份字幕。[字幕下载接口](https://developers.google.com/youtube/v3/docs/captions/download)
- 官方政策限制未经书面批准下载、缓存其音视频及提供离线播放，也禁止收费或其他门槛来解锁嵌入视频观看。因此「视频离线下载」应限于自有或许可下载的素材；YouTube 播放不应作为 VIP 解锁观看权益。也不能将它抽取成音轨、隐藏播放器或遮挡其品牌和功能来复用现有播放器。[YouTube 开发者政策](https://developers.google.com/youtube/terms/developer-policies)

可实现的首步是符合嵌入要求的视频播放，以及用户提供或平台具有明确使用权限的 SRT／VTT 字幕和配套学习文本。这一步不需要增加 AI 服务商或 YouTube key。自动字幕暂以自有／获授权上传的音视频接入已选 Flash-Lite；YouTube URL 的自动字幕接入仍待验证，不能通过下载或抽取任意 YouTube 音视频来绕开上述限制。

## TED：需要素材授权边界

TED 当前使用政策要求商业场景取得许可，也对字幕、衍生内容和播放方式有约束。把 TED 素材放入收费跟读产品，并进行字幕编辑、台词本导出或离线分发，不能仅凭公开视频地址认定已经获得权限。[TED 内容使用政策](https://www.ted.com/about/our-organization/our-policies-terms/ted-talks-usage-policy)

历史官方博客介绍过 TED API，但没有据此确认目前存在可公开申请、适用于本产品商业用途的全量内容接口。需要向内容方确认当下的接入与授权范围，不能承诺「所有 TED 演讲」。授权获得后，持有可播放媒体和字幕即可实现变速跟读。[TED 历史 API 公告](https://blog.ted.com/announced-at-sxsw-ted-to-open-api/) · [TED 授权申请说明](https://help.ted.com/hc/en-us/articles/360004233294-How-do-I-license-TED-or-TEDx-content)

## 建议的实施顺序

1. 先验证 Gemini 2.5 Flash-Lite 的时间轴质量；云端媒体建议采用 R2，完成桶与服务端凭证配置后验证直传与 Range 播放。
2. 实现素材／文件、已有字幕导入与校正、笔记收藏、练习记录等业务接口；复用翻译和查词，新增 AI 台词讲解。
3. 接入经过验证的自动字幕任务；再接真实支付、验单和会员／兑换码。
4. YouTube、TED 按官方播放器与已获授权的素材范围实施；继续在订阅页标记规划中，直到实际接入范围确认。

## 源码依据与核查边界

- `server/src/infrastructure/ai/evolink-client.ts:36`：AI 请求输入类型；`:82`：Chat Completions 调用。
- `server/src/infrastructure/ai/types.ts:35`：当前 AI provider 方法。
- `server/src/modules/translation/routes.ts:38`、`:60`：可复用的句子翻译、语境查词。
- `packages/contracts/src/index.ts:451`、`:471`：文章上传类型与大小限制；`:683`：文章外部视频引用。
- `server/src/modules/editorial/audio-routes.ts:48`：外刊音频读取。
- `server/src/config/env.ts:69`、`:74`：文章上传临时资产与草稿有效期。
- `app/src/features/subscription/plans.ts`、`docs/reading-speaking-frontend.md`：当前权益与服务边界。

本次验证的是源码与公开文档。没有进行 EvoLink 付费请求、账户模型权限检查、真实转写质量测试、支付商户联调或第三方内容授权确认。文档支持的能力与本账号实测可用性分别记录，不以网页列出模型作为上线验收。

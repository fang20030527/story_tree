# 口语首页「播客」栏目

素材来源：`D:\qBittorrent\下载\播客`。共三档节目、13 期完整视频，总时长约 31.4 小时，原文件合计 12,591,745,185 字节。

| 节目 | 期数 | 英文字幕句数 |
| --- | ---: | ---: |
| Joe Rogan Experience | 3（#2219 特朗普、#2404 马斯克、#2422 黄仁勋） | 9,899 |
| The Diary of a CEO | 5 | 11,921 |
| The Iced Coffee Hour | 5 | 12,550 |
| 合计 | 13 | 34,370 |

## 栏目行为

- 「播客」位于口语素材主页的「美剧/英剧」之后，沿用现有横向浏览和「更多」入口。
- 首页和「更多」均展示节目总名、英文名及期数，点击节目进入对应的选集页，再选择单集进入跟读详情。
- 三个节目为「乔·罗根访谈」（3 期）、「CEO 日记」（5 期）、「冰咖啡时刻」（5 期）。节目列表支持英文节目名、中文嘉宾和期号搜索；搜索单集时保留所属节目的完整选集和期数。选集页支持单集搜索并保留继续跟读时间。
- 同一节目各期共用下载目录提供的方形封面；主页、节目列表、选集和详情页保留完整封面比例。
- 每期沿用素材详情、影子跟读、逐句播放和台词本导出。视频来源显示为「播客原声」。

## 媒体与字幕

原文件均为 1080p MP4，包含 AAC 音轨，未提供外挂或内嵌字幕。六期 H.264 视频保留原画质直接使用；另外七期 AV1 视频制作 720p H.264／AAC 兼容播放副本，保留完整时间轴与原下载文件。可播放文件合计 14,699,661,329 字节。

英文字幕使用本机 Whisper large-v3 转写。每十分钟保存可恢复的词级时间戳，片段之间保留重叠上下文，再按自然语句和停顿整理为跟读单元；中文翻译为空。复查较长的字幕空白，对五段漏识别的快速语音重新连续转写，补回 24 句，最终共 34,370 句。字幕通过共享契约、顺序、唯一编号、媒体时长和发布对象大小校验；未发现异常的长句重复。自动字幕仍可能包含专名或口语识别错误，可使用现有字幕校正功能。

转码前后检查原文件大小和修改时间，并检查播放编码、尺寸、时长；每个可播放文件抽检首段、中段和尾段的真实解码。R2 对象按素材 ID 和 SHA-256 存放，分片支持断点续传，上传后校验对象大小、校验和元数据和三段 Range 字节。

## 本地处理

处理脚本、原始转写、播放副本、上传断点和验证报告位于被 Git 忽略的 `.local-test-results/speaking/podcasts-2026-10-03/`。源下载目录只读。

```powershell
node .local-test-results/speaking/podcasts-2026-10-03/progress.mjs
node --import tsx .local-test-results/speaking/podcasts-2026-10-03/upload-podcasts.mjs --upload --native-http
node --import tsx .local-test-results/speaking/podcasts-2026-10-03/validate-podcasts.mjs
node --import tsx .local-test-results/speaking/podcasts-2026-10-03/upload-podcasts.mjs --assemble
node --import tsx .local-test-results/speaking/podcasts-2026-10-03/upload-podcasts.mjs --preflight
node --import tsx .local-test-results/speaking/podcasts-2026-10-03/upload-podcasts.mjs --publish
node --import tsx .local-test-results/speaking/podcasts-2026-10-03/verify-live.mjs
```

发布先保存这 13 期的字幕详情，再读取最新云端目录、合并本次条目，通过 `If-Match` 写入目录，保留已有节目和其他导入。[Cloudflare R2 条件写入说明](https://developers.cloudflare.com/r2/api/s3/api/)

## 验证与发布状态

客户端 104 个测试套件、568 项测试通过，类型检查与 lint 通过（保留 24 条已有警告）。Web 静态导出通过。用于网页发布的独立构建包以已提交版本为基准加入相关栏目文件，通过类型检查、Wrangler 部署预检和客户端密钥扫描（1,104 个文件，6 个已配置服务端密钥）。

浏览器验证了主页的三个节目入口、13 期完整列表、中文／英文／期号搜索、393 像素宽度的布局及横向浏览。首期 1280×720 视频成功解码，点击第 2 句后跳转到 5.9 秒并继续播放；黄仁勋访谈保留的 1920×1080 视频也成功加载、按字幕定位并持续播放。工作区预览为 `http://127.0.0.1:8102`，独立发布包预览为 `http://127.0.0.1:8103`。

13 期视频已全部上传并发布，合计 14,699,661,329 字节、34,370 句英文字幕。线上目录由 44 个素材增至 57 个，既有 44 个素材的摘要逐项保持一致。每期的目录摘要、详情字幕、播放链接，以及文件头、中段、尾段的跨域 Range 读取均通过线上验证。

播客素材首次发布到 `https://blackholeenglish.com` 的网页版本为 `0a6372ce-d7d1-4672-bb79-1a517c3072fa`。发布使用本机已有的 Wrangler 登录状态。一次性脚本依次合并本地目录、检查云端对象、发布详情与摘要、逐期验证线上接口，最后部署独立网页包。

```powershell
node .local-test-results/speaking/podcasts-2026-10-03/finish-publishing.mjs --apply
```

素材首次发布时，线上浏览器确认口语主页在「美剧/英剧」后展示「播客」，三个节目各有一个方形封面入口，「更多」当时为完整 13 期列表；按中文嘉宾「黄仁勋」、英文节目名 `iced coffee` 和期号 `#2422` 搜索均得到预期结果。黄仁勋访谈解码为 1920×1080，点击第 2 句后跳至 5.88 秒并持续播放到 63.69 秒，未出现媒体错误。

主页截图为 `online-home.png`，完整栏目截图为 `online-section.png`，原画质播放截图为 `online-playback-1080.png`。`migration-report.json`、`transcription-report.json`、`prepared-validation-report.json`、`publication-report.json`、`live-verification-report.json`、`web-deployment-report.json`、`finish-publishing-report.json` 和 `online-browser-report.json` 均为 `passed`；六个发布步骤全部通过。

## 节目入口与选集页更新

新增 `/speaking/podcast?podcast=<节目 ID>` 路由，使用节目分组生成独立选集；主页和「更多」共用节目名、英文名、方形封面与期数。单集继续使用原有详情与跟读流程。实现沿用项目现有的 Expo Router 路由方式，并核对 [SDK 57 官方文档](https://docs.expo.dev/versions/v57.0.0/sdk/router/)。

工作区与独立网页发布包的 5 个相关测试套件、21 项测试均通过，包括节目分组、嘉宾与期号搜索、两种入口进入选集、选集进入指定单集、跟读进度及加载／空状态。两者类型检查通过；客户端 lint 为 0 错误、24 条已有警告。独立网页构建包含 42 个静态路由，通过 Wrangler 部署预检与客户端密钥扫描（1,116 个文件，6 个已配置服务端密钥）。

本地浏览器以桌面和 393×852 手机视口确认三个节目入口、节目列表、各节目完整的 3／5／5 期选集、单集搜索、返回导航，并从黄仁勋访谈入口加载正确的跟读详情。构建与验证记录保存在 `.local-test-results/speaking/podcast-navigation-2026-10-03/`，只读预览使用 `http://127.0.0.1:8104`。

节目入口与选集更新已发布到 `https://blackholeenglish.com`，网页版本为 `1dd0f27b-6f4e-4ded-9464-79e5a8b91f2d`，基于上一版 `7b8f5d39-4305-445f-8f2e-d57ebe0a59ee` 保留电视剧分组与选集。线上浏览器确认：首页三个入口均为节目名，点击乔·罗根访谈进入其 3 期选集，并保留黄仁勋访谈的继续跟读时间；「更多」只展示三档节目，点击 CEO 日记及冰咖啡时刻分别进入对应的 5 期选集。

此次发布包相较上一版新增 5 个播客路由、组件和测试文件，更新 5 个相关源码／测试文件；通过源文件哈希和当前网页版本检查后部署。验证报告为 `release-validation.json`、`preview-navigation-report.json`、`web-deployment-report.json`、`online-navigation-report.json`，截图为 `online-home.png`、`online-more.png`、`online-selection.png`。

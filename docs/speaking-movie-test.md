# 带字幕电影的口语跟读测试

本轮只实现和验证已有字幕的流程：本地音视频上传、SRT／VTT 导入与校正、账号私有资源、字幕收藏与笔记、录音关联、练习记录，以及支持跳转的 HTTP Range 播放。不会为无字幕电影生成字幕，不调用 EvoLink 或其他付费模型。

下载目录中找到的无外置字幕影片是《星际穿越》（Interstellar，2014）。没有找到与它配套的 SRT／VTT 文件；随后通过 FFprobe 确认仅有 H.264 视频和 AAC 音轨，没有内嵌字幕轨。没有检查画面是否烧录字幕。

## 自动化测试

- `packages/contracts/src/speaking.test.ts` 验证严格请求结构、合法 YouTube 视频编号、字幕排序与编号唯一、对白重叠、版本号、3 GiB 上传边界，以及分页摘要不会携带整片字幕。
- `server/src/modules/speaking/speaking.integration.test.ts` 通过真实数据库的随机隔离 Schema，验证二进制上传重放与内容冲突、字幕导入和校正、版本与并发冲突、收藏笔记与录音的账号隔离、练习记录累计保存且旧记录不会覆盖新进度、平台素材的个人覆盖，以及签名媒体的 Range／HEAD／篡改／过期处理。还验证媒体删除失败时保留清理队列，成功重试后删除对象与队列记录。媒体探测使用假处理器，测试音频是自动生成的小 WAV 文件。
- `server/scripts/speaking-movie-smoke.ts` 使用真实 FFprobe 和真实 HTTP，将带字幕电影流式上传到本次专用的临时本地存储。不会把电影整片读入内存，也不会上传到 R2。

数据库验证复用 `withTestDatabase`：只创建、迁移和清理随机的 `app_test_*` Schema，不执行 `public` Schema 迁移，不删除原有业务数据。电影源文件只读；临时文件清理前检查绝对路径的目录边界。

## 运行方式

契约测试：

```powershell
npm run test --workspace=@context-reader/contracts
```

服务端集成测试（读取 `app/.env` 中的数据库配置，优先使用 `TEST_DATABASE_URL`）：

```powershell
Set-Location server
node ../node_modules/vitest/vitest.mjs run src/modules/speaking/speaking.integration.test.ts
```

真实电影测试默认关闭，需要显式启用，并提供本机 FFprobe 可执行文件：

```powershell
Set-Location server
$env:RUN_SPEAKING_MOVIE_SMOKE = '1'
$env:MOVIE_TEST_ROOT = 'D:/qBittorrent/下载'
$env:FFPROBE_PATH = '本机 ffprobe.exe 的绝对路径'
node --env-file=../app/.env --import tsx scripts/speaking-movie-smoke.ts
```

测试仅监听本机 `127.0.0.1` 随机端口。上传电影后，导入完整字幕并校正一条字幕，保存收藏、笔记和练习记录，检查其他账号无法获取素材和播放链接，再对影片首部、中部、尾部各读取 64 KiB，并与原文件逐字节比较。每部影片结束后清理本次存储的媒体对象。

摘要报告写到 `.local-test-results/speaking/movie-report.json`，只保留影片名称、大小、时长、字幕数量、结果和耗时；不记录原始文件路径、字幕正文、签名地址、令牌或环境变量值。

## 本次实测结果

15 项契约测试及完整数据库集成已通过。三份实际 SRT 已通过生产字幕解析器的只读预检：阿甘正传 1,593 句、泰坦尼克号 2,046 句、The Odyssey 1,407 句。阿甘正传的英文字幕使用 Windows-1252 编码，测试脚本会先严格检查 UTF-8，失败后按 Windows-1252 解码，避免标点丢失。

2026-10-01 完成真实 HTTP 冒烟，进程退出码为 0。三部影片均完整流式上传，使用真实 FFprobe 探测，并经过全量 SRT 导入、字幕校正、收藏笔记、练习记录重放与账号隔离验证。

| 影片 | 文件大小（约） | 探测时长（约） | 字幕句数 | 首／中／尾 Range | 结果 |
| --- | --- | --- | --- | --- | --- |
| 阿甘正传 | 852 MiB | 02:22:09 | 1,593 | 3 段均与源文件逐字节一致 | 通过 |
| The Odyssey（按本地目录标识） | 1,623 MiB | 01:26:03 | 1,407 | 3 段均与源文件逐字节一致 | 通过 |
| 泰坦尼克号 | 1,097 MiB | 03:06:50 | 2,046 | 3 段均与源文件逐字节一致 | 通过 |
| 星际穿越 | — | — | 未找到外置 SRT | 按本轮范围跳过 | 跳过 |

本次上传共 3,746,314,922 字节（约 3.49 GiB），完整保留 5,046 条英文字幕，校验 9 个 64 KiB 播放片段。外部 AI 调用与真实 R2 上传均为 0。

每部影片结束后删除本次存储的媒体对象；整个测试结束后删除临时媒体目录和隔离数据库 Schema。结束后检查残留 `speaking-movie-smoke-*` 临时目录数量为 0，下载目录源文件保持只读。

本机详细摘要位于 `.local-test-results/speaking/movie-report.json`，不纳入版本控制。此报告覆盖后端文件和字幕链路；iOS、Android 与 Web 播放器的完整播放体验需要相应客户端验证。

## 后续 R2 固定资源迁移

同日根据用户要求，三部有字幕影片及原始 SRT 已另行迁入私有 R2 桶，作为口语「素材」中的所有用户可见资源，不属于任何个人文件库。真实 R2 读写、九段源文件字节比对、公开素材与播放接口、Web 按句定位和持续播放验收均通过；详见 [R2 迁移报告](speaking-r2-migration.md)。本页上述临时测试数据已清理的结论只指初次隔离测试，已发布的 R2 固定资源保留。

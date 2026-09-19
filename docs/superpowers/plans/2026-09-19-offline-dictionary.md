# 离线词典实施计划

**Goal:** 用手机端剑桥词典取代单词翻译 API，支持无网络查词。

**Architecture:** Python 构建工具读取 MDX 并生成分片 JSON；TypeScript 本地模块处理规范化、词形与 DTO；现有查词入口委托该模块。目标词辅助记录与本地释义解耦。

**Tech Stack:** Python readmdict / BeautifulSoup；Expo 57、TypeScript、Jest；静态 JSON（无需原生依赖）。

## 约束

- 词典：`剑桥在线英汉双解词典完美版/cdepe.mdx`；仅打包文本字段。
- 释义 <= 200 字，词性 <= 40 字；无词条时不调用 API。
- 现有工作区有其他修改，只改本功能涉及的代码。

## 任务一：生成离线数据

- [x] 检查真实词条 HTML，确定释义、词性、音标、词形选择器。
- [x] 新增 `tools/dictionary/build.py`、`requirements.txt`、`test_build.py`：先写 HTML 解析测试，再实现 `parse_entry` 和 MDX 转换。通过 `python -m unittest discover -s tools/dictionary -p 'test_*.py'` 验证。
- [x] 生成 `app/src/features/dictionary/data/*.json`、`generated.ts`、`manifest.json`；输出转换统计，验证 bank、resilient、went 等真实词条。

## 任务二：本地查词与接入

- [x] 新增 `app/src/features/dictionary/lookup.test.ts`，验证 `lookupLocalWord({term, context?}): Promise<WordTranslationDto>` 对大小写、词形、未收录词的处理；断言 fetch 未调用。
- [x] 实现 `lookup.ts`，用静态 require 索引按需读分片，精确命中优先于词尾还原，使用共用 DTO 契约校验结果。
- [x] 修改 `app/src/api/practices.ts`：`requestWordTranslation` 委托 `lookupLocalWord`；更新 `client.test.ts` 为真实离线查词断言。
- [x] 修改 `app/src/app/practice/[id]/read.tsx`：本地结果不等待辅助记录；失败释放重试标记并保留幂等键，不回退服务端含义。
- [x] 更新 `app/src/__tests__/practice-read.test.tsx`，添加辅助记录失败仍显示释义的回归测试；查词卡注明本地词典。

## 任务三：验收与文档

- [x] 运行 `npm run check`，记录通过及环境限制。
- [x] 执行 `npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke` 验证离线数据进入发布包。
- [x] `tools/dictionary/README.md` 记录重建命令、数据大小、来源范围以及功能边界；审查变更无整套 MDX/MDD 或密钥进入包。


## 实施结果（2026-09-19）

- 生成数据：65,839 条中文词条、87,858 个有效跳转；128 个分片，13,161,564 字节。
- 使用 lxml 解析 HTML；构建工具只依赖 readmdict、python-lzo、lxml。修正重复跳转冲突，优先相同词干；全部跳转与释义通过数据完整性测试。
- `npm run typecheck` 通过；客户端 49 个测试文件、240 项测试通过；服务端非集成测试 30 个文件、185 项通过；契约 30 项通过；Python 转换器 6 项通过。
- `npm run lint` 通过（现有 19 条警告，无错误；本功能生成文件没有 lint 警告）。
- Web 发布导出成功；直接检查发布 JS：包含真实词条和修正的 restores 跳转，没有 `/v1/word-translations`、MDX 或 MDD 资源。
- `npm run check` 已执行，但服务端完整测试持续约 4 分钟没有输出测试结果，已中断；单独验证数据库只读连通性正常，不能据此确定停滞原因。完整数据库集成测试未完成，不宣称全仓检查通过。
- 尚未进行真机安装测试。未提交或发布，保留工作区其他已有修改。

# 剑桥离线单词词典

客户端的 `requestWordTranslation` 现在直接查询随应用发布的词典，不再请求 `/v1/word-translations`，也不需要安装身份或 API 地址。句子、段落和全文翻译仍使用原有服务。未找到词条时显示“本地词典未收录这个词”，不回退 AI。

## 数据

- 来源：项目内 `剑桥在线英汉双解词典完美版/cdepe.mdx`，CDEPE En-Cn V2025.5.18。
- 65,839 条有中文释义的词条、87,858 个可解析的词形／跳转索引。
- 128 个 JSON 分片，合计 13,161,564 字节（约 12.6 MiB），不含 MDX、MDD、音频、图片、HTML 或脚本。
- 原词典声明：仅供个人学习研究使用，不得用于商业用途。生成的数据沿用该使用范围。
- `app/src/features/dictionary/manifest.json` 保存来源校验和、数据版本和统计。

`generated.ts` 使用显式静态 `require`，所有分片随发布包提供，查询时才加载对应分片；没有远程下载地址或新增原生依赖。发布安装包时可直接离线查词；Expo 开发模式仍需先从 Metro 加载应用。Web 导出包含词典，但网页自身的离线启动需要浏览器已加载页面（本改动不增加 PWA 缓存）。

## 重新生成

Python 3.9+。macOS 上先安装 LZO 头文件：

```sh
brew install lzo
python3 -m venv tools/dictionary/.venv
CFLAGS="-I$(brew --prefix lzo)/include" LDFLAGS="-L$(brew --prefix lzo)/lib" tools/dictionary/.venv/bin/pip install -r tools/dictionary/requirements.txt
tools/dictionary/.venv/bin/python -m unittest discover -s tools/dictionary -p 'test_*.py'
tools/dictionary/.venv/bin/python tools/dictionary/build.py
```

其他系统需先安装 LZO 开发包；构建依赖仅用于转换，不进入客户端。也可通过 `--source` 和 `--output` 指定 MDX 与输出目录。输出 JSON、`generated.ts`、`manifest.json` 应随源码保留，以免每次应用构建都要求本机有原词典。

## 行为与边界

优先精确词条，再跟随词典链接，最后尝试常见复数、过去式、分词、比较级和所有格。已有独立释义的词（例如 running）优先保留自身词义。went、children 等词形说明附带原词的简明含义。工具只提取中文定义，不把例句译文或页面脚本当作释义；不包含同义词、语法和例句辅助页面。

词性、英美音标保留；多义词按词典顺序展示。释义最长 200 字以兼容生词本契约，超长内容以省略号标明；这不是完整词典浏览器，也不做 AI 语境消歧。未收录的派生词不会凭空生成翻译。发音继续使用设备系统语音。

练习目标词在本地释义显示后异步记录“使用提示”，不等待网络。该业务记录用于练习统计，不调用翻译 API；失败后下次点击重试并复用幂等键。加入生词本仍需联网。普通查词不再从服务端获取历史保存原句；本次加入生词本和成功的目标词辅助记录仍可显示已知原句。

## 验证

```sh
npm test --workspace=app -- --runTestsByPath src/features/dictionary/lookup.test.ts src/features/dictionary/data.test.ts src/api/client.test.ts src/__tests__/practice-read.test.tsx
npm run check
npm exec --workspace=app expo export -- --platform web --output-dir dist-smoke
```

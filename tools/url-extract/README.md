# URL 提取小工具

对照服务端文章导入（Readability）在本地提取正文和图片，并支持**一键打包下载**。

## 面板（推荐）

在仓库根目录：

```bash
node tools/url-extract/serve.mjs
```

浏览器打开 http://127.0.0.1:8787  

点 **「提取并打包下载」**：抓取正文、下载图片，打成 zip 并开始下载。  
**「再次下载 zip」**可重下刚生成的那一份。

zip 内含：`article.txt`、`meta.json`、`images/`。

## 命令行

```bash
node tools/url-extract/extract.mjs 'https://example.com/article'
node tools/url-extract/extract.mjs 'https://example.com/article' \
  --out ./tools/url-extract/out/demo \
  --download-images
```

## 说明

- 依赖仓库已安装的 `@mozilla/readability`、`linkedom`。
- 拒绝 localhost / 内网地址。
- 请遵守目标站点条款与版权，仅用于你自己粘贴的公开 URL。

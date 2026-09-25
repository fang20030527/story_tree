export function renderUnavailablePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>电脑上传暂不可用</title>
<style>
body { margin: 0; padding: 48px 16px; background: #f6f4ef;
  color: #23201a; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
main { box-sizing: border-box; max-width: 420px; margin: auto; padding: 32px 28px;
  border-radius: 12px; background: #fff; box-shadow: 0 2px 12px #0001; }
h1 { margin: 0 0 12px; font-size: 20px; }
p { margin: 0; color: #5a544a; font-size: 14px; line-height: 1.7; }
</style>
</head>
<body><main><h1>电脑上传暂不可用</h1>
<p>文章导入服务暂时不可用，请稍后在手机应用中重试。</p></main></body>
</html>`;
}

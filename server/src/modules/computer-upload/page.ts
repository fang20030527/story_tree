const baseStyles = `
  body {
    margin: 0;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f6f4ef;
    color: #23201a;
    display: flex;
    justify-content: center;
    padding: 48px 16px;
  }
  main {
    width: 100%;
    max-width: 420px;
    background: #ffffff;
    border-radius: 12px;
    padding: 32px 28px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.7; margin: 0 0 20px; color: #5a544a; }
  label { display: block; font-size: 14px; margin-bottom: 8px; }
  input[type="text"], input[type="file"] {
    width: 100%;
    box-sizing: border-box;
    font-size: 18px;
    padding: 10px 12px;
    margin-bottom: 20px;
    border: 1px solid #cfc9bd;
    border-radius: 8px;
  }
  button {
    width: 100%;
    font-size: 16px;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: #2f5d3a;
    color: #ffffff;
    cursor: pointer;
  }
`;

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${baseStyles}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

export function renderCodePage(): string {
  return document(
    '电脑上传',
    `<h1>电脑上传文章</h1>
<p>请输入手机应用中显示的 10 位上传码。上传码在 10 分钟内有效，只能使用一次。</p>
<form method="post" action="/computer-upload/claim">
<label for="code">上传码</label>
<input id="code" name="code" type="text" inputmode="latin" autocomplete="off" autocapitalize="characters" minlength="10" maxlength="11" required>
<button type="submit">下一步</button>
</form>`,
  );
}

export function renderUploadPage(): string {
  return document(
    '选择文件',
    `<h1>选择要上传的文件</h1>
<p>支持 TXT、Markdown、HTML、DOCX、PDF 与常见图片格式，单个文件不超过 10 MB。文件名不会被保存。</p>
<form method="post" action="/computer-upload/file" enctype="multipart/form-data">
<label for="file">文章文件</label>
<input id="file" name="file" type="file" required>
<button type="submit">上传</button>
</form>`,
  );
}

export function renderDonePage(): string {
  return document(
    '上传完成',
    `<h1>上传完成</h1>
<p>文件已送达，请回到手机应用继续。本页面可以关闭。</p>`,
  );
}

export const browserErrorKinds = [
  'invalid_or_expired',
  'already_used',
  'too_large',
  'unsupported',
  'too_many_attempts',
] as const;

export type BrowserErrorKind = (typeof browserErrorKinds)[number];

const errorCopy: Record<BrowserErrorKind, string> = {
  invalid_or_expired: '上传码无效或已过期，请在手机应用中重新获取。',
  already_used: '本次上传已完成或已被使用，请在手机应用中重新获取上传码。',
  too_large: '文件超过大小限制，请压缩或选择更小的文件。',
  unsupported: '该文件类型暂不支持，请更换文件后重试。',
  too_many_attempts: '尝试次数过多，请稍后再试。',
};

export function renderBrowserErrorPage(kind: BrowserErrorKind): string {
  return document(
    '无法继续',
    `<h1>无法继续</h1>
<p>${errorCopy[kind]}</p>`,
  );
}

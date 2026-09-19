#!/usr/bin/env node
/**
 * Local UI for URL extract + zip download.
 *   node tools/url-extract/serve.mjs
 *   open http://127.0.0.1:8787
 */
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { extractToFiles, slugify } from './lib.mjs';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.URL_EXTRACT_PORT || 8787);
const HOST = '127.0.0.1';

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>URL 提取 · 打包下载</title>
  <style>
    :root { color-scheme: light dark; --bg:#0f1115; --card:#1a1d24; --text:#e8eaed; --muted:#9aa0a6; --accent:#5b8cff; --ok:#3dd68c; --danger:#ff6b6b; --border:#2a2f3a; }
    @media (prefers-color-scheme: light) {
      :root { --bg:#f4f6f8; --card:#fff; --text:#1a1a1a; --muted:#667; --accent:#2f6fed; --ok:#0a7; --danger:#c33; --border:#e2e6ee; }
    }
    * { box-sizing: border-box; }
    body { margin:0; font: 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
    main { max-width: 720px; margin: 40px auto; padding: 0 20px 60px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p.lead { color: var(--muted); margin: 0 0 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    label { display:block; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    input[type=url] { width:100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--text); font-size: 15px; }
    .row { display:flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    button { appearance:none; border:0; border-radius: 10px; padding: 11px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .primary { background: var(--accent); color: #fff; }
    .download { background: var(--ok); color: #062016; }
    .ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
    #status { margin-top: 14px; min-height: 1.4em; color: var(--muted); font-size: 13px; }
    #status.error { color: var(--danger); }
    #preview { margin-top: 18px; display:none; }
    #preview h2 { font-size: 16px; margin: 0 0 8px; }
    #meta { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
    #text { white-space: pre-wrap; max-height: 280px; overflow: auto; padding: 12px; border-radius: 10px; border: 1px solid var(--border); font-size: 13px; line-height: 1.55; }
    #thumbs { display:flex; gap:8px; flex-wrap:wrap; margin-top: 12px; }
    #thumbs img { width: 88px; height: 88px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); background: #0001; }
  </style>
</head>
<body>
  <main>
    <h1>URL 提取</h1>
    <p class="lead">输入公开网页地址，提取正文和图片，一键打包成 zip 下载。</p>
    <div class="card">
      <label for="url">网页 URL</label>
      <input id="url" type="url" placeholder="https://..." autocomplete="off" />
      <div class="row">
        <button class="primary" id="extractBtn" type="button">提取并打包下载</button>
        <button class="download" id="downloadBtn" type="button" disabled>再次下载 zip</button>
      </div>
      <div id="status">就绪</div>
    </div>
    <div class="card" id="preview">
      <h2 id="title"></h2>
      <div id="meta"></div>
      <div id="text"></div>
      <div id="thumbs"></div>
    </div>
  </main>
  <script>
    const urlEl = document.getElementById('url');
    const statusEl = document.getElementById('status');
    const extractBtn = document.getElementById('extractBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const preview = document.getElementById('preview');
    let lastZipUrl = null;

    function setStatus(msg, isError) {
      statusEl.textContent = msg;
      statusEl.className = isError ? 'error' : '';
    }

    function revokeLast() {
      if (lastZipUrl) URL.revokeObjectURL(lastZipUrl);
      lastZipUrl = null;
      downloadBtn.disabled = true;
    }

    function triggerDownload(blob, filename) {
      revokeLast();
      lastZipUrl = URL.createObjectURL(blob);
      downloadBtn.disabled = false;
      const a = document.createElement('a');
      a.href = lastZipUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    downloadBtn.onclick = () => {
      if (!lastZipUrl) return;
      const a = document.createElement('a');
      a.href = lastZipUrl;
      a.download = downloadBtn.dataset.name || 'article.zip';
      a.click();
    };

    extractBtn.onclick = async () => {
      const url = urlEl.value.trim();
      if (!url) { setStatus('请先输入 URL', true); return; }
      extractBtn.disabled = true;
      setStatus('正在提取正文和图片…');
      preview.style.display = 'none';
      try {
        const res = await fetch('/api/extract-zip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || '提取失败');
        }
        const meta = JSON.parse(decodeURIComponent(res.headers.get('X-Extract-Meta') || '%7B%7D'));
        const blob = await res.blob();
        const filename = res.headers.get('X-Zip-Filename') || 'article.zip';
        downloadBtn.dataset.name = filename;
        triggerDownload(blob, filename);

        document.getElementById('title').textContent = meta.title || '(无标题)';
        document.getElementById('meta').textContent =
          (meta.wordCount || 0) + ' 词 · ' + (meta.imageCount || 0) + ' 张图 · ' + (meta.finalUrl || '');
        document.getElementById('text').textContent = meta.textPreview || '';
        const thumbs = document.getElementById('thumbs');
        thumbs.innerHTML = '';
        for (const src of meta.imagePreviewUrls || []) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = '';
          thumbs.appendChild(img);
        }
        preview.style.display = 'block';
        setStatus('已开始下载：' + filename);
      } catch (e) {
        setStatus(e.message || String(e), true);
      } finally {
        extractBtn.disabled = false;
      }
    };

    urlEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') extractBtn.click();
    });
  </script>
</body>
</html>`;

async function zipDirectory(dir, zipPath) {
  // macOS / Linux zip CLI; run from parent so archive has a single top folder name
  const parent = join(dir, '..');
  const folder = dir.split('/').pop();
  await execFileAsync('zip', ['-r', '-q', zipPath, folder], { cwd: parent });
}

async function handleExtractZip(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'JSON 无效' }));
    return;
  }
  const url = String(body.url || '').trim();
  if (!url) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: '缺少 url' }));
    return;
  }

  const tmp = await mkdtemp(join(tmpdir(), 'url-extract-'));
  try {
    const { outRoot, meta, text } = await extractToFiles(url, {
      outDir: join(tmp, 'article'),
      downloadImages: true,
    });
    const zipName = `${slugify(meta.title, 'article')}.zip`;
    const zipPath = join(tmp, zipName);
    await zipDirectory(outRoot, zipPath);
    const zipBuf = await readFile(zipPath);

    const headerMeta = {
      title: meta.title,
      finalUrl: meta.finalUrl,
      wordCount: meta.wordCount,
      imageCount: meta.imageCount,
      textPreview: text.slice(0, 1200),
      imagePreviewUrls: (meta.images || [])
        .filter((i) => i.url && !i.error)
        .slice(0, 8)
        .map((i) => i.url),
    };

    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': zipBuf.length,
      'content-disposition': `attachment; filename="${zipName}"`,
      'X-Zip-Filename': zipName,
      'X-Extract-Meta': encodeURIComponent(JSON.stringify(headerMeta)),
      'Cache-Control': 'no-store',
    });
    res.end(zipBuf);
  } catch (err) {
    res.writeHead(422, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || String(err) }));
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer(async (req, res) => {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const url = new URL(req.url || '/', `http://${host}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const body = Buffer.from(HTML, 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
    });
    res.end(body);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/extract-zip') {
    await handleExtractZip(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`URL 提取面板: http://${HOST}:${PORT}`);
  console.log('主按钮会提取正文+图片并直接打包下载 zip；「再次下载」可重下同一份。');
});

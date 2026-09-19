/**
 * Shared URL → text + images extraction (Readability), same idea as app import.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const BLOCK_SELECTOR = [
  'article',
  'section',
  'div',
  'p',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'li',
  'figcaption',
].join(',');

export const MAX_BYTES = 2_000_000;
export const TIMEOUT_MS = 25_000;
export const MAX_IMAGES = 30;
export const USER_AGENT =
  'Mozilla/5.0 (compatible; ContextReaderUrlExtract/1.0; +local-tool)';

export function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL 无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http/https');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  ) {
    throw new Error('拒绝本机/内网地址（与线上导入策略一致）');
  }
  return url.toString();
}

export async function fetchHtml(initialUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = initialUrl;
  let redirects = 0;
  try {
    while (redirects <= 5) {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) throw new Error(`重定向缺少 Location（HTTP ${res.status}）`);
        current = assertPublicHttpUrl(new URL(location, current).toString());
        redirects += 1;
        continue;
      }
      if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (type && type !== 'text/html' && type !== 'application/xhtml+xml') {
        throw new Error(`内容类型不支持：${type || '(empty)'}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        throw new Error(`页面过大（>${MAX_BYTES} bytes）`);
      }
      if (!buf.byteLength) throw new Error('页面为空');
      return { finalUrl: current, html: buf.toString('utf8') };
    }
    throw new Error('重定向次数过多');
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBlockText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function extractReadableText(content, fallback) {
  const { document } = parseHTML(content ?? '');
  const blocks = Array.from(document.querySelectorAll(BLOCK_SELECTOR))
    .filter((el) => !el.querySelector(BLOCK_SELECTOR))
    .map((el) => normalizeBlockText(el.textContent || ''))
    .filter(Boolean);
  return blocks.length > 0
    ? blocks.join('\n\n')
    : normalizeBlockText(fallback ?? '');
}

function absolutize(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function looksLikeImageUrl(url) {
  const path = new URL(url).pathname.toLowerCase();
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?|$)/i.test(path);
}

function collectImages(document, contentHtml, baseUrl) {
  const seen = new Set();
  const images = [];

  const push = (raw, alt = '') => {
    if (!raw || raw.startsWith('data:')) return;
    const abs = absolutize(raw, baseUrl);
    if (!abs || seen.has(abs)) return;
    try {
      const u = new URL(abs);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    } catch {
      return;
    }
    seen.add(abs);
    images.push({ url: abs, alt: (alt || '').trim() });
  };

  if (contentHtml) {
    const { document: contentDoc } = parseHTML(contentHtml);
    for (const img of contentDoc.querySelectorAll('img')) {
      const src =
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        '';
      const srcset = img.getAttribute('srcset') || '';
      if (src) push(src, img.getAttribute('alt') || '');
      if (srcset) {
        const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
        if (first) push(first, img.getAttribute('alt') || '');
      }
    }
  }

  if (images.length === 0) {
    for (const sel of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
    ]) {
      const content = document.querySelector(sel)?.getAttribute('content');
      if (content) push(content, 'cover');
    }
  }

  if (images.length === 0) {
    for (const img of document.querySelectorAll('img')) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      const abs = absolutize(src, baseUrl);
      if (abs && looksLikeImageUrl(abs)) {
        push(src, img.getAttribute('alt') || '');
      }
      if (images.length >= 5) break;
    }
  }

  return images.slice(0, MAX_IMAGES);
}

export function extractArticle(html, sourceUrl) {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll(
    'script,style,noscript,template,iframe,object,embed',
  )) {
    el.remove();
  }
  const base = document.createElement('base');
  base.setAttribute('href', sourceUrl);
  document.head.prepend(base);

  const readableDocument = document.cloneNode(true);
  const parsed = new Readability(readableDocument, {
    charThreshold: 20,
    maxElemsToParse: 50_000,
    disableJSONLD: false,
  }).parse();

  const text = parsed
    ? extractReadableText(parsed.content, parsed.textContent)
    : '';
  if (!text) {
    throw new Error('未能从网页中提取正文');
  }

  const images = collectImages(document, parsed?.content || '', sourceUrl);
  return {
    title: parsed?.title?.trim() || null,
    byline: parsed?.byline?.trim() || null,
    excerpt: parsed?.excerpt?.trim() || null,
    text,
    images,
  };
}

export function slugify(title, fallback) {
  const base = (title || fallback || 'article')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'article';
}

export function guessExt(url, contentType) {
  const fromType = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
  }[contentType?.split(';')[0]?.trim().toLowerCase() || ''];
  if (fromType) return fromType;
  try {
    const ext = extname(new URL(url).pathname);
    if (ext && ext.length <= 5) return ext;
  } catch {
    /* ignore */
  }
  return '.img';
}

export async function downloadImage(url, destPath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*;q=0.8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 8_000_000) throw new Error('image too large');
    const finalPath = destPath.replace(/\.[^.]+$/, guessExt(url, type));
    await writeFile(finalPath, buf);
    return finalPath;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractToFiles(url, { outDir, downloadImages = true } = {}) {
  const startUrl = assertPublicHttpUrl(url);
  const { finalUrl, html } = await fetchHtml(startUrl);
  const article = extractArticle(html, finalUrl);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outRoot = resolve(
    outDir ||
      join(
        fileURLToPath(new URL('.', import.meta.url)),
        'out',
        `${stamp}-${slugify(article.title, 'article')}`,
      ),
  );
  await mkdir(outRoot, { recursive: true });

  const imageRecords = [];
  if (downloadImages && article.images.length > 0) {
    const imgDir = join(outRoot, 'images');
    await mkdir(imgDir, { recursive: true });
    let i = 0;
    for (const img of article.images) {
      i += 1;
      const stub = join(imgDir, String(i).padStart(3, '0') + '.img');
      try {
        const saved = await downloadImage(img.url, stub);
        imageRecords.push({
          ...img,
          localPath: saved.slice(outRoot.length + 1),
        });
      } catch (err) {
        imageRecords.push({ ...img, error: String(err.message || err) });
      }
    }
  } else {
    for (const img of article.images) imageRecords.push({ ...img });
  }

  const meta = {
    sourceUrl: startUrl,
    finalUrl,
    title: article.title,
    byline: article.byline,
    excerpt: article.excerpt,
    wordCount: article.text.split(/\s+/u).filter(Boolean).length,
    imageCount: imageRecords.length,
    images: imageRecords,
    extractedAt: new Date().toISOString(),
  };

  await writeFile(join(outRoot, 'article.txt'), article.text, 'utf8');
  await writeFile(join(outRoot, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return { outRoot, meta, text: article.text };
}

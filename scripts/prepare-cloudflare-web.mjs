/** 把 Web 版按需读取的外刊正文复制到静态导出，并检查免费套餐文件限制。 */
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const source = join(repoRoot, 'app/src/features/editorial/epub/issues');
const output = join(repoRoot, 'app/dist');
const target = join(output, 'epub/issues');
const scriptDirectory = join(output, '_expo/static/js/web');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20_000;

const outputInfo = await stat(output).catch(() => null);
if (!outputInfo?.isDirectory()) throw new Error('请先运行 Expo Web 静态导出');
await mkdir(target, { recursive: true });

const ignored = [];
for (const entry of await readdir(scriptDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/^entry-[a-f0-9]+\.js$/u.test(entry.name)) continue;
  const path = join(scriptDirectory, entry.name);
  const compressed = `${path}.gz`;
  await pipeline(createReadStream(path), createGzip({ level: 9 }), createWriteStream(compressed));
  if ((await stat(compressed)).size > MAX_FILE_BYTES) {
    throw new Error('压缩后的 Web 入口仍超过 Cloudflare 单文件限制');
  }
  ignored.push(`/_expo/static/js/web/${entry.name}`);
}
if (ignored.length !== 1) throw new Error('Web 入口文件数量异常');
await writeFile(join(output, '.assetsignore'), `${ignored.join('\n')}\n`, 'utf8');

// 页面曾缓存错误的压缩响应；给入口脚本加版本参数使浏览器重新请求。
const entryUrl = ignored[0];
if (!entryUrl) throw new Error('缺少 Web 入口文件');
async function versionHtml(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await versionHtml(path);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const html = await readFile(path, 'utf8');
      const versioned = html.replaceAll(`${entryUrl}"`, `${entryUrl}?encoding=manual"`);
      if (versioned !== html) await writeFile(path, versioned, 'utf8');
    }
  }
}
await versionHtml(output);

let copied = 0;
let bytes = 0;
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isFile() || !/^[a-z0-9-]+\.json$/u.test(entry.name)) {
    throw new Error('外刊期号文件格式无效');
  }
  const path = join(source, entry.name);
  const info = await stat(path);
  if (info.size > MAX_FILE_BYTES) throw new Error('外刊期号文件超过 Cloudflare 单文件限制');
  await copyFile(path, join(target, entry.name));
  copied++;
  bytes += info.size;
}

let totalFiles = 0;
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(path);
    } else if (entry.isFile()) {
      totalFiles++;
      if ((await stat(path)).size > MAX_FILE_BYTES
        && !ignored.includes(`/${path.slice(output.length + 1).replaceAll('\\', '/')}`)) {
        throw new Error('Web 静态文件超过 Cloudflare 单文件限制');
      }
    }
  }
}
await checkDirectory(output);
if (totalFiles > MAX_FILES) throw new Error('Web 静态文件数超过 Cloudflare 免费套餐限制');
process.stdout.write(`${JSON.stringify({ copiedIssues: copied, copiedBytes: bytes, totalFiles, compressedEntry: ignored.length })}\n`);

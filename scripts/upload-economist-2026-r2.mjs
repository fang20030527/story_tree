/** 上传全部 2026 MP3 到私有 R2；默认只盘点，显式 --upload 才写入。 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceMap = JSON.parse(await readFile(join(repoRoot, 'server/assets/editorial/audio-local.json'), 'utf8'));
const args = process.argv.slice(2);
const upload = args.includes('--upload');
const rootArgument = args.find((arg) => !arg.startsWith('--')) ?? process.env.EDITORIAL_AUDIO_ROOT;
if (!rootArgument) throw new Error('请传入包含 2026/ 的音频目录');
const audioRoot = basename(rootArgument) === '2026' ? dirname(rootArgument) : rootArgument;
const yearRoot = join(audioRoot, '2026');

const articleByPath = new Map();
for (const [articleId, relativePath] of Object.entries(sourceMap)) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/u.test(articleId)
    || !/^2026\/2026-\d{2}-\d{2}\/[^/\\]+\.mp3$/iu.test(relativePath)
    || articleByPath.has(relativePath)) throw new Error('2026 音频清单无效');
  articleByPath.set(relativePath, articleId);
}

const entries = [];
for (const issue of (await readdir(yearRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!issue.isDirectory()) continue;
  if (!/^2026-\d{2}-\d{2}$/u.test(issue.name)) throw new Error('2026 音频期号目录无效');
  const issueRoot = join(yearRoot, issue.name);
  for (const file of (await readdir(issueRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!file.isFile() || !file.name.toLowerCase().endsWith('.mp3')) continue;
    const relativePath = `2026/${issue.name}/${file.name}`;
    const articleId = articleByPath.get(relativePath);
    const digest = createHash('sha256').update(relativePath).digest('hex').slice(0, 32);
    const key = articleId
      ? `audio/2026/${articleId}.mp3`
      : `audio/2026/unmatched/${issue.name}/${digest}.mp3`;
    const source = join(issueRoot, file.name);
    const info = await stat(source);
    if (!info.size) throw new Error('2026 音频存在空文件');
    entries.push({ source, relativePath, key, bytes: info.size, matched: Boolean(articleId) });
  }
}

const foundPaths = new Set(entries.map((entry) => entry.relativePath));
if (foundPaths.size !== entries.length || [...articleByPath.keys()].some((path) => !foundPaths.has(path))) {
  throw new Error('2026 音频与文章清单不一致');
}
const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
if (totalBytes > 10_000_000_000) throw new Error('2026 音频已超出 R2 10 GB 免费存储量');
process.stdout.write(`${JSON.stringify({
  files: entries.length,
  matched: entries.filter((entry) => entry.matched).length,
  archived: entries.filter((entry) => !entry.matched).length,
  bytes: totalBytes,
  mode: upload ? 'upload' : 'inventory',
})}\n`);
if (!upload) process.exit(0);

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME ?? 'waikan-2026-audio';
if (!accountId || !/^[a-f0-9]{32}$/iu.test(accountId) || !accessKeyId || !secretAccessKey) {
  throw new Error('请在本地环境中配置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY');
}
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
  maxAttempts: 8,
});

async function remoteHead(key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

let next = 0;
let uploaded = 0;
let skipped = 0;
let failure;
async function uploadWorker() {
  while (next < entries.length && !failure) {
    const index = next++;
    const entry = entries[index];
    try {
      const data = await readFile(entry.source);
      const digest = createHash('sha256').update(data).digest('hex');
      const existing = await remoteHead(entry.key);
      if (existing?.ContentLength === entry.bytes && existing.Metadata?.sha256 === digest) {
        skipped++;
      } else {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: entry.key,
          Body: data,
          ContentLength: entry.bytes,
          ContentType: 'audio/mpeg',
          Metadata: { sha256: digest },
        }));
        const saved = await remoteHead(entry.key);
        if (saved?.ContentLength !== entry.bytes || saved.Metadata?.sha256 !== digest) {
          throw new Error('上传后校验失败');
        }
        uploaded++;
      }
      if ((uploaded + skipped) % 100 === 0) {
        process.stdout.write(`${JSON.stringify({ completed: uploaded + skipped, uploaded, skipped })}\n`);
      }
    } catch (error) {
      failure = { index, name: error?.name ?? 'UnknownError', status: error?.$metadata?.httpStatusCode };
    }
  }
}

await Promise.all(Array.from({ length: 4 }, () => uploadWorker()));
client.destroy();
if (failure) throw new Error(`R2 上传中断：序号 ${failure.index + 1}，${failure.name}，HTTP ${failure.status ?? '未知'}`);
process.stdout.write(`${JSON.stringify({ completed: uploaded + skipped, uploaded, skipped, bytes: totalBytes })}\n`);

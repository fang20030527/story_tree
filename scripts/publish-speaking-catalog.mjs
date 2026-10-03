/** 默认核验；--output-dir 离线打包，--apply 发布已自带中文的字幕与摘要。 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertPlatformTranslationsComplete, loadSpeakingCatalogData } from '../server/src/modules/speaking/catalog.ts';

const { values } = parseArgs({ options: { apply: { type: 'boolean' }, 'output-dir': { type: 'string' } } });
const apply = values.apply ?? false;
const outputDir = values['output-dir'] ? resolve(values['output-dir']) : null;
if (apply && outputDir) throw new Error('INVALID_ARGUMENT');
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = loadSpeakingCatalogData(resolve(root, 'server/content/speaking/catalog.json'));
assertPlatformTranslationsComplete(catalog);
const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
if (!outputDir) {
  for (const name of names) if (!process.env[name]) throw new Error(`MISSING_${name}`);
  if (!/^[a-f0-9]{32}$/iu.test(process.env.R2_ACCOUNT_ID)) throw new Error('INVALID_R2_ACCOUNT_ID');
}
const client = outputDir ? null : new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const bucket = process.env.R2_BUCKET_NAME;
const prefix = 'speaking/platform/release';
const rows = [];
async function publish(key, value, maxBytes) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > maxBytes) throw new Error('CATALOG_OBJECT_TOO_LARGE');
  if (outputDir) {
    const path = resolve(outputDir, key.slice(prefix.length + 1));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return;
  }
  if (!apply) return;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
    ContentType: 'application/json', Metadata: { sha256 } }));
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (object.ContentLength !== bytes.length || !object.Body) throw new Error('CATALOG_ROUNDTRIP_FAILED');
  if (!Buffer.from(await object.Body.transformToByteArray()).equals(bytes)) throw new Error('CATALOG_ROUNDTRIP_FAILED');
}
try {
  for (const material of catalog.materials.values()) {
    if (!/^[A-Za-z0-9_-]+$/u.test(material.id)) throw new Error('INVALID_MATERIAL_ID');
    const media = catalog.media.get(material.id) ?? null;
    if (media && client) {
      const object = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: media.storageKey }));
      if (object.ContentLength !== media.byteSize || object.Metadata?.sha256 !== media.sha256 ||
        object.ContentType !== media.contentType) throw new Error('MOVIE_OBJECT_CHANGED');
    }
    const { cues, ...summary } = material;
    await publish(`${prefix}/${material.id}/material.json`, material, 2 * 1024 ** 2);
    rows.push({ material: { ...summary, cueCount: cues.length }, media });
  }
  // 先保存所有详情，再替换目录。影片对象只核对，不复制或改写。
  await publish(`${prefix}/catalog.json`, { materials: rows }, 256 * 1024);
  console.log(JSON.stringify({ status: 'passed', applied: apply, packed: Boolean(outputDir), materials: rows.length,
    movies: rows.filter(row => row.media).length, subtitleCues: rows.reduce((sum, row) => sum + row.material.cueCount, 0) }));
} catch (error) {
  const allowed = new Set(['CATALOG_OBJECT_TOO_LARGE', 'CATALOG_ROUNDTRIP_FAILED', 'MOVIE_OBJECT_CHANGED', 'INVALID_MATERIAL_ID']);
  console.error(allowed.has(error.message) ? error.message : 'SPEAKING_CATALOG_PUBLISH_FAILED');
  process.exitCode = 1;
} finally { client?.destroy(); }

/** 从已核验的固定素材生成 Worker 目录；默认只读，--apply 发布字幕与摘要。 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadSpeakingCatalogData } from '../server/src/modules/speaking/catalog.ts';

const apply = process.argv.slice(2).includes('--apply');
if (process.argv.slice(2).some(argument => argument !== '--apply')) throw new Error('INVALID_ARGUMENT');
const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
for (const name of names) if (!process.env[name]) throw new Error(`MISSING_${name}`);
const account = process.env.R2_ACCOUNT_ID;
if (!/^[a-f0-9]{32}$/iu.test(account)) throw new Error('INVALID_R2_ACCOUNT_ID');
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = loadSpeakingCatalogData(resolve(root, 'server/content/speaking/catalog.json'));
const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const bucket = process.env.R2_BUCKET_NAME;
const prefix = 'speaking/platform/release';
const rows = [];
async function publish(key, value, maxBytes) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > maxBytes) throw new Error('CATALOG_OBJECT_TOO_LARGE');
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
    const media = catalog.media.get(material.id) ?? null;
    if (media) {
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
  console.log(JSON.stringify({ status: 'passed', applied: apply, materials: rows.length,
    movies: rows.filter(row => row.media).length, subtitleCues: rows.reduce((sum, row) => sum + row.material.cueCount, 0) }));
} catch (error) {
  const allowed = new Set(['CATALOG_OBJECT_TOO_LARGE', 'CATALOG_ROUNDTRIP_FAILED', 'MOVIE_OBJECT_CHANGED']);
  console.error(allowed.has(error.message) ? error.message : 'SPEAKING_CATALOG_PUBLISH_FAILED');
  process.exitCode = 1;
} finally { client.destroy(); }

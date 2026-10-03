import {
  SPEAKING_MAX_MEDIA_BYTES,
  SpeakingCatalogDtoSchema,
  SpeakingMaterialDtoSchema,
  SpeakingMaterialSummarySchema,
  SpeakingMediaTypeSchema,
  SpeakingPlaybackDtoSchema,
  SpeakingResourceIdSchema,
  type SpeakingCatalogDto,
  type SpeakingMaterialDto,
} from '@context-reader/contracts';
import { z } from 'zod';
import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';
import {
  assertSpeakingObjectKey,
  signSpeakingObject,
  SPEAKING_CATALOG_PLAYBACK_SECONDS,
} from './signing';

const RELEASE_PREFIX = 'speaking/platform/release';
const CATALOG_MAX_BYTES = 256 * 1024;
const MATERIAL_MAX_BYTES = 2 * 1024 * 1024;
const PlatformSummarySchema = SpeakingMaterialSummarySchema.extend({
  sourceKind: z.literal('platform'), assetId: z.null(), videoId: z.null(),
}).strict();
const PlatformMediaSchema = z.object({
  storageKey: z.string().min(1).max(512).refine(key => {
    try { assertSpeakingObjectKey(key); return key.startsWith('speaking/platform/'); }
    catch { return false; }
  }),
  byteSize: z.number().int().positive().max(SPEAKING_MAX_MEDIA_BYTES),
  contentType: SpeakingMediaTypeSchema,
  sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/u),
}).strict();
const ReleaseCatalogSchema = z.object({
  materials: z.array(z.object({
    material: PlatformSummarySchema,
    media: PlatformMediaSchema.nullable(),
  }).strict()).max(100),
}).strict();
type ReleaseCatalog = z.infer<typeof ReleaseCatalogSchema>;

/** 目录只解析摘要；整片字幕按需从独立对象读取。 */
export async function getPlatformCatalog(env: ApiEnv): Promise<SpeakingCatalogDto> {
  const catalog = await readCatalog(env);
  return SpeakingCatalogDtoSchema.parse({ materials: catalog.materials.map(item => item.material) });
}

export async function getPlatformMaterial(env: ApiEnv, id: string): Promise<SpeakingMaterialDto> {
  assertMaterialId(id);
  const catalog = await readCatalog(env);
  const entry = findEntry(catalog, id);
  const raw = await readReleaseJson(env, `${RELEASE_PREFIX}/${id}/material.json`, MATERIAL_MAX_BYTES);
  const parsed = SpeakingMaterialDtoSchema.safeParse(raw);
  if (!parsed.success) throw invalidRelease();
  const material = parsed.data;
  const { cues, ...summary } = material;
  const actualSummary = { ...summary, cueCount: cues.length };
  if (Object.entries(entry.material).some(([key, value]) =>
    actualSummary[key as keyof typeof actualSummary] !== value,
  ) || cues.some(cue => cue.end > material.duration + 0.1)) throw invalidRelease();
  // 公开接口只读发布字幕；账号的覆盖字幕由私有路由读取。
  return material;
}

export async function getPlatformPlayback(env: ApiEnv, id: string) {
  assertMaterialId(id);
  const entry = findEntry(await readCatalog(env), id);
  if (!entry.media) throw new AppError('NOT_FOUND', '此示范素材没有云端视频', 404);
  const expiresAt = new Date(Date.now() + SPEAKING_CATALOG_PLAYBACK_SECONDS * 1000).toISOString();
  const url = await signSpeakingObject(env, entry.media.storageKey, 'GET', undefined, undefined, SPEAKING_CATALOG_PLAYBACK_SECONDS);
  return SpeakingPlaybackDtoSchema.parse({ url, expiresAt });
}

export async function handlePublicSpeakingRoute(request: Request, env: ApiEnv): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = new URL(request.url).pathname;
  if (path === '/v1/speaking/catalog') {
    return Response.json(await getPlatformCatalog(env), { headers: { 'cache-control': 'no-store' } });
  }
  const playback = /^\/v1\/speaking\/catalog\/([^/]+)\/playback$/u.exec(path);
  if (playback) {
    return Response.json(await getPlatformPlayback(env, playback[1]!), {
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  }
  const material = /^\/v1\/speaking\/catalog\/([^/]+)$/u.exec(path);
  if (!material) return null;
  return Response.json(await getPlatformMaterial(env, material[1]!), {
    headers: { 'cache-control': 'no-store' },
  });
}

async function readCatalog(env: ApiEnv): Promise<ReleaseCatalog> {
  const raw = await readReleaseJson(env, `${RELEASE_PREFIX}/catalog.json`, CATALOG_MAX_BYTES);
  const parsed = ReleaseCatalogSchema.safeParse(raw);
  if (!parsed.success) throw invalidRelease();
  const seen = new Set<string>();
  for (const entry of parsed.data.materials) {
    const material = entry.material;
    if (seen.has(material.id) || material.duration <= 0 || material.duration > 86_400 ||
        material.cueCount < 1 || /[^A-Za-z0-9_-]/u.test(material.id) ||
        (entry.media && (material.mediaType === 'video') !== entry.media.contentType.startsWith('video/')) ||
        (!entry.media && material.mediaType === 'video')) throw invalidRelease();
    seen.add(material.id);
  }
  return parsed.data;
}

function findEntry(catalog: ReleaseCatalog, id: string): ReleaseCatalog['materials'][number] {
  const entry = catalog.materials.find(item => item.material.id === id);
  if (!entry) throw new AppError('NOT_FOUND', '固定口语素材不存在', 404);
  return entry;
}

function assertMaterialId(id: string): void {
  if (!SpeakingResourceIdSchema.safeParse(id).success || /[^A-Za-z0-9_-]/u.test(id)) {
    throw new AppError('VALIDATION_ERROR', '固定口语素材编号无效', 400);
  }
}

async function readReleaseJson(env: ApiEnv, key: string, maxBytes: number): Promise<unknown> {
  if (!env.SPEAKING_BUCKET) {
    throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '口语云端存储尚未配置', 503, true);
  }
  try {
    const object = await env.SPEAKING_BUCKET.get(key);
    if (!object) throw invalidRelease();
    const reader = object.body.getReader();
    let completed = false;
    try {
      if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > maxBytes) {
        throw invalidRelease();
      }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const text: string[] = [];
      let total = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > maxBytes) throw invalidRelease();
        text.push(decoder.decode(result.value, { stream: true }));
      }
      completed = true;
      text.push(decoder.decode());
      return JSON.parse(text.join('')) as unknown;
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch {
    // 不把内部对象键、原字幕或 R2 原始错误带进响应及日志。
    throw invalidRelease();
  }
}

function invalidRelease() {
  return new AppError('MEDIA_UNAVAILABLE', '固定口语素材暂时不可用，请稍后重试', 503, true);
}

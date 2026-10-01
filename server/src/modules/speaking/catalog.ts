import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SpeakingCatalogDtoSchema, SpeakingMaterialDtoSchema, SpeakingMediaTypeSchema,
  SpeakingPlaybackDtoSchema, SPEAKING_MAX_MEDIA_BYTES, type SpeakingMaterialDto,
} from '@context-reader/contracts';
import { z } from 'zod';
import { AppError } from '../../core/errors';
import { validateMediaKey } from '../../infrastructure/media/safety';
import type { MediaStore } from '../../infrastructure/media/store';
import { validateSpeakingCues } from './subtitles';

const PublishedMediaSchema = z.object({
  storageKey: z.string().min(1).max(512).refine((value) => {
    try { validateMediaKey(value); return value.startsWith('speaking/platform/'); }
    catch { return false; }
  }, '固定媒体对象键无效'),
  byteSize: z.number().int().positive().max(SPEAKING_MAX_MEDIA_BYTES),
  contentType: SpeakingMediaTypeSchema,
  sha256: z.string().length(64).regex(/^[a-f0-9]{64}$/u),
}).strict();
const PublishedCatalogSchema = z.object({
  materials: z.array(z.object({
    material: SpeakingMaterialDtoSchema,
    media: PublishedMediaSchema,
  }).strict()).max(100),
}).strict();

export interface LoadedSpeakingCatalog {
  materials: ReadonlyMap<string, SpeakingMaterialDto>;
  media: ReadonlyMap<string, z.infer<typeof PublishedMediaSchema>>;
}

export function loadSpeakingCatalog(path: string): ReadonlyMap<string, SpeakingMaterialDto> {
  return loadSpeakingCatalogData(path).materials;
}

/** 发布清单与原创目录相邻，缺少可选清单时保留原目录。 */
export function loadSpeakingCatalogData(path: string): LoadedSpeakingCatalog {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const fixture = z.object({ materials: z.array(z.object({
      id: z.string(), title: z.string(), subtitle: z.string(), category: z.string(),
      duration: z.number(), cues: z.array(z.unknown()),
    })).max(100) }).parse(raw);
    const materials = new Map<string, SpeakingMaterialDto>();
    const media = new Map<string, z.infer<typeof PublishedMediaSchema>>();
    const append = (material: SpeakingMaterialDto) => {
      if (materials.has(material.id) || materials.size >= 100 || material.duration <= 0 || material.duration > 86_400) throw invalidCatalog();
      validateSpeakingCues(material.cues, material.duration);
      materials.set(material.id, material);
    };
    for (const item of fixture.materials) append(SpeakingMaterialDtoSchema.parse({ ...item,
      sourceKind: 'platform', mediaType: 'audio', assetId: null, videoId: null, revision: 1,
      createdAt: '2026-09-30T00:00:00.000Z' }));
    const publishedText = optionalPublishedText(join(dirname(path), 'cloud-catalog.json'));
    if (publishedText !== null) {
      const published = PublishedCatalogSchema.parse(JSON.parse(publishedText) as unknown);
      for (const item of published.materials) {
        if (item.material.sourceKind !== 'platform' || item.material.assetId !== null || item.material.videoId !== null ||
          (item.material.mediaType === 'video') !== item.media.contentType.startsWith('video/')) throw invalidCatalog();
        append(item.material);
        media.set(item.material.id, item.media);
      }
    }
    return { materials, media };
  } catch {
    throw invalidCatalog();
  }
}

export function getPublicSpeakingCatalog(catalog: LoadedSpeakingCatalog) {
  return SpeakingCatalogDtoSchema.parse({ materials: [...catalog.materials.values()].map(({ cues, ...summary }) =>
    ({ ...summary, cueCount: cues.length })) });
}

export function getPublicSpeakingMaterial(catalog: LoadedSpeakingCatalog, materialId: string) {
  const material = catalog.materials.get(materialId);
  if (!material) throw new AppError('NOT_FOUND', '固定口语素材不存在', 404);
  // 返回原字幕副本，不读取任何用户状态或个人字幕覆盖。
  return SpeakingMaterialDtoSchema.parse(material);
}

export async function getPublicSpeakingPlayback(catalog: LoadedSpeakingCatalog, store: MediaStore | undefined, materialId: string) {
  if (!catalog.materials.has(materialId)) throw new AppError('NOT_FOUND', '固定口语素材不存在', 404);
  const media = catalog.media.get(materialId);
  if (!media) throw new AppError('NOT_FOUND', '此示范素材没有云端视频', 404);
  if (store?.driver !== 'r2' || !store.signedReadUrl) {
    throw new AppError('MEDIA_STORAGE_NOT_CONFIGURED', '固定素材的云端播放尚未配置', 503, true);
  }
  const expiresSeconds = 600;
  const expiresAt = Date.now() + expiresSeconds * 1000;
  const url = await store.signedReadUrl(media.storageKey, expiresSeconds);
  return SpeakingPlaybackDtoSchema.parse({ url, expiresAt: new Date(expiresAt).toISOString() });
}

function optionalPublishedText(path: string): string | null {
  try { return readFileSync(path, 'utf8'); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function invalidCatalog() {
  return new AppError('INTERNAL_ERROR', '口语固定素材目录无效，请检查服务端发布清单', 500);
}

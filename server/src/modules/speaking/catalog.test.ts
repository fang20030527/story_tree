import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPublicSpeakingCatalog, getPublicSpeakingMaterial, getPublicSpeakingPlayback,
  loadSpeakingCatalog, loadSpeakingCatalogData,
} from './catalog';
import type { MediaStore } from '../../infrastructure/media/store';

const originalFixture = {
  source: '原创示范音', materials: [{ id: 'demo-audio', title: 'An original example', subtitle: '原创音频',
    category: '日常表达', duration: 10, cues: [{ id: 'demo-cue', start: 1, end: 3, en: 'Try something new.', zh: '试试新的事情。' }] }],
};
const cloudFixture = {
  materials: [{
    material: { id: 'film-example', title: 'A shared film', subtitle: '固定电影', category: '电影对白',
      sourceKind: 'platform' as const, mediaType: 'video' as const, assetId: null, videoId: null,
      duration: 120, revision: 1, createdAt: '2026-10-01T08:00:00.000Z',
      cues: [{ id: 'film-cue', start: 1, end: 4, en: 'We can start here.', zh: '我们可以从这里开始。' }] },
    media: { storageKey: 'speaking/platform/film-example/source.mp4', byteSize: 1234,
      contentType: 'video/mp4', sha256: 'a'.repeat(64) },
  }],
};

let directory: string;
let catalogPath: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'speaking-catalog-test-'));
  catalogPath = join(directory, 'catalog.json');
  await writeFile(catalogPath, JSON.stringify(originalFixture));
});
afterEach(async () => {
  const absolute = resolve(directory);
  const child = relative(resolve(tmpdir()), absolute);
  if (child && !child.startsWith('..') && !isAbsolute(child) && basename(absolute).startsWith('speaking-catalog-test-')) {
    await rm(absolute, { recursive: true, force: true });
  }
});

describe('口语固定发布目录', () => {
  it('可选云清单不存在时保留原创素材，示范音不伪造云端播放', async () => {
    const catalog = loadSpeakingCatalogData(catalogPath);
    expect([...loadSpeakingCatalog(catalogPath).keys()]).toEqual(['demo-audio']);
    expect(catalog.media.size).toBe(0);
    await expect(getPublicSpeakingPlayback(catalog, undefined, 'demo-audio')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('合并公共素材，摘要和详情不泄露内部媒体字段', async () => {
    await publish(cloudFixture);
    const catalog = loadSpeakingCatalogData(catalogPath);
    const list = getPublicSpeakingCatalog(catalog);
    expect(list.materials.map(value => value.id)).toEqual(['demo-audio', 'film-example']);
    expect(list.materials[1]).toMatchObject({ cueCount: 1, sourceKind: 'platform', assetId: null });
    expect(JSON.stringify(list)).not.toContain('storageKey');
    expect(JSON.stringify(list)).not.toContain('film-cue');
    const detail = getPublicSpeakingMaterial(catalog, 'film-example');
    expect(detail).toEqual(cloudFixture.materials[0]!.material);
    expect(JSON.stringify(detail)).not.toContain('source.mp4');
    detail.cues[0]!.en = 'Do not mutate the shared original.';
    expect(getPublicSpeakingMaterial(catalog, 'film-example').cues[0]!.en).toBe('We can start here.');
    expect(catalog.media.get('film-example')?.storageKey).toBe(cloudFixture.materials[0]!.media.storageKey);
  });

  it('云端播放仅用内部索引签名十分钟，不依赖用户数据库', async () => {
    await publish(cloudFixture);
    const catalog = loadSpeakingCatalogData(catalogPath);
    const signedReadUrl = vi.fn().mockResolvedValue('https://example.invalid/film.mp4?signature=test-only');
    const store = { driver: 'r2', signedReadUrl } as unknown as MediaStore;
    const before = Date.now();
    const playback = await getPublicSpeakingPlayback(catalog, store, 'film-example');
    expect(signedReadUrl).toHaveBeenCalledWith(cloudFixture.materials[0]!.media.storageKey, 3600);
    expect(Date.parse(playback.expiresAt)).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(Date.parse(playback.expiresAt)).toBeLessThanOrEqual(Date.now() + 3_600_000);
    await expect(getPublicSpeakingPlayback(catalog, undefined, 'film-example')).rejects.toMatchObject({ code: 'MEDIA_STORAGE_NOT_CONFIGURED' });
    await expect(getPublicSpeakingPlayback(catalog, store, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    { media: { storageKey: 'users/private/source.mp4' } },
    { media: { storageKey: 'speaking/platform/../private.mp4' } },
    { media: { storageKey: 'speaking/platform/file.mp4:stream' } },
    { media: { contentType: 'audio/mpeg' } },
    { media: { byteSize: 0 } },
    { media: { sha256: 'invalid' } },
    { material: { sourceKind: 'file' } },
    { material: { assetId: '7e623cdb-6702-441c-a010-dc8622a8d6f9' } },
    { material: { cues: [{ id: 'bad-cue', start: 1, end: 121, en: 'Beyond duration.', zh: '' }] } },
    { material: { id: 'demo-audio' } },
    { material: { userId: 'private-user' } },
  ])('拒绝非法发布数据且错误不包含对象键或目录路径', async (patch) => {
    const entry = cloudFixture.materials[0]!;
    await publish({ materials: [{ material: { ...entry.material, ...patch.material }, media: { ...entry.media, ...patch.media } }] });
    let error: unknown;
    try { loadSpeakingCatalogData(catalogPath); } catch (value) { error = value; }
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(String(error)).not.toContain(directory);
    expect(String(error)).not.toContain('speaking/platform');
  });
});

async function publish(value: unknown) {
  await writeFile(join(dirname(catalogPath), 'cloud-catalog.json'), JSON.stringify(value));
}

import { SpeakingCatalogDtoSchema, SpeakingMaterialDtoSchema } from '@context-reader/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ApiEnv, SpeakingR2BucketBinding } from '../env';
import { getPlatformCatalog, getPlatformMaterial, handlePublicSpeakingRoute } from './catalog';

const PREFIX = 'speaking/platform/release';
const MOVIE_KEY = 'speaking/platform/movies/forrest-gump/film.mp4';
const DATE = '2026-09-30T00:00:00.000Z';

function material(id: string, video = false) {
  return SpeakingMaterialDtoSchema.parse({
    id, title: id, subtitle: '固定素材', category: '日常表达',
    sourceKind: 'platform', mediaType: video ? 'video' : 'audio', assetId: null, videoId: null,
    duration: 20, revision: 1, createdAt: DATE,
    cues: [{ id: 'cue-1', start: 1, end: 4, en: 'Life is full of possibilities.', zh: '生活充满可能。' }],
  });
}

function fixture() {
  const details = [
    material('curiosity'), material('small-talk'), material('storytelling'),
    material('forrest-gump', true), material('titanic', true), material('the-odyssey', true),
  ];
  const entries = details.map(({ cues, ...summary }) => ({
    material: { ...summary, cueCount: cues.length },
    media: summary.mediaType === 'video' ? {
      storageKey: `speaking/platform/movies/${summary.id}/film.mp4`,
      byteSize: 1_234_567, contentType: 'video/mp4', sha256: 'a'.repeat(64),
    } : null,
  }));
  const objects = new Map<string, string>([[`${PREFIX}/catalog.json`, JSON.stringify({ materials: entries })]]);
  for (const detail of details) objects.set(`${PREFIX}/${detail.id}/material.json`, JSON.stringify(detail));
  const get = vi.fn(async (key: string) => {
    const text = objects.get(key);
    if (text === undefined) return null;
    const bytes = new TextEncoder().encode(text);
    return {
      body: new Response(bytes).body!, size: bytes.byteLength,
      etag: 'test-etag', httpEtag: '"test-etag"', httpMetadata: { contentType: 'application/json' },
    };
  });
  const bucket: SpeakingR2BucketBinding = {
    get, head: vi.fn(async () => null), delete: vi.fn(async () => undefined),
  };
  const env = {
    SPEAKING_BUCKET: bucket,
    R2_ACCOUNT_ID: 'abcdef0123456789abcdef0123456789', R2_BUCKET_NAME: 'waikan-2026-audio',
    R2_ACCESS_KEY_ID: 'TESTACCESSKEY', R2_SECRET_ACCESS_KEY: 'test-secret-never-published',
  } as ApiEnv;
  return { env, get, objects, entries, details };
}

describe('生产固定口语目录', () => {
  it('游客目录只读摘要，涵盖三个示范和三个影片，剥离内部映射', async () => {
    const { env, get } = fixture();
    const response = await handlePublicSpeakingRoute(new Request('https://api.test/v1/speaking/catalog'), env);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    const text = await response!.text();
    const catalog = SpeakingCatalogDtoSchema.parse(JSON.parse(text) as unknown);
    expect(catalog.materials).toHaveLength(6);
    expect(catalog.materials.filter(item => item.mediaType === 'video')).toHaveLength(3);
    expect(text).not.toContain('storageKey');
    expect(text).not.toContain('sha256');
    expect(text).not.toContain('cues');
    expect(get.mock.calls).toEqual([[`${PREFIX}/catalog.json`]]);
  });

  it('详情只读所选影片原字幕，不读取 D1 或任何账号覆盖', async () => {
    const { env, get, details } = fixture();
    Object.defineProperty(env, 'DB', { get() { throw new Error('公开接口不应读取账号'); } });
    const response = await handlePublicSpeakingRoute(
      new Request('https://api.test/v1/speaking/catalog/forrest-gump', {
        headers: { authorization: 'Bearer private-account-token' },
      }), env,
    );
    expect(await response?.json()).toEqual(details[3]);
    expect(get.mock.calls).toEqual([[`${PREFIX}/catalog.json`], [`${PREFIX}/forrest-gump/material.json`]]);
  });

  it('影片播放仅生成一小时私有签名，不读取整部视频对象', async () => {
    const { env, get } = fixture();
    const now = Date.now();
    const response = await handlePublicSpeakingRoute(
      new Request('https://api.test/v1/speaking/catalog/forrest-gump/playback'), env,
    );
    const playback = await response!.json() as { url: string; expiresAt: string };
    const signed = new URL(playback.url);
    expect(signed.pathname).toBe(`/waikan-2026-audio/${MOVIE_KEY}`);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(new Date(playback.expiresAt).getTime()).toBeGreaterThanOrEqual(now + 3_599_000);
    expect(new Date(playback.expiresAt).getTime()).toBeLessThan(Date.now() + 3_601_000);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('referrer-policy')).toBe('no-referrer');
    expect(get.mock.calls).toEqual([[`${PREFIX}/catalog.json`]]);
  });

  it('原示范不伪造云端视频播放地址', async () => {
    const { env } = fixture();
    await expect(handlePublicSpeakingRoute(
      new Request('https://api.test/v1/speaking/catalog/curiosity/playback'), env,
    )).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('只从目录中已有 ID 读取详情，禁止任意私有对象路径', async () => {
    const { env, get } = fixture();
    await expect(getPlatformMaterial(env, 'unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getPlatformMaterial(env, '../users/private')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(getPlatformMaterial(env, 'curiosity\n')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(get.mock.calls).toEqual([[`${PREFIX}/catalog.json`]]);
  });

  it('发布清单缺少绑定或对象时返回稳定错误', async () => {
    await expect(getPlatformCatalog({} as ApiEnv)).rejects.toMatchObject({ code: 'MEDIA_STORAGE_NOT_CONFIGURED' });
    const { env, objects } = fixture();
    objects.clear();
    await expect(getPlatformCatalog(env)).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE', retryable: true });
  });

  it.each(['duplicate', 'private-key', 'private-source', 'invalid-media', 'extra-fields'])('拒绝错误清单 %s', async invalid => {
    const { env, objects, entries } = fixture();
    if (invalid === 'duplicate') entries.push(entries[0]!);
    if (invalid === 'private-key') entries[3]!.media!.storageKey = 'users/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/source';
    if (invalid === 'private-source') Object.assign(entries[0]!.material, { sourceKind: 'file' });
    if (invalid === 'invalid-media') entries[3]!.media!.contentType = 'audio/mpeg';
    if (invalid === 'extra-fields') Object.assign(entries[0]!.material, { secret: 'never-publish' });
    objects.set(`${PREFIX}/catalog.json`, JSON.stringify({ materials: entries }));
    await expect(getPlatformCatalog(env)).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE' });
  });

  it.each(['wrong-id', 'changed-revision', 'changed-duration', 'changed-count', 'out-of-bounds-cue', 'extra-key'])(
    '拒绝与摘要不一致的单片详情 %s', async invalid => {
      const { env, objects, details } = fixture();
      const detail = details[3]!;
      if (invalid === 'wrong-id') detail.id = 'titanic';
      if (invalid === 'changed-revision') detail.revision = 2;
      if (invalid === 'changed-duration') detail.duration = 21;
      if (invalid === 'changed-count') detail.cues.push({ ...detail.cues[0]!, id: 'cue-2' });
      if (invalid === 'out-of-bounds-cue') detail.cues[0]!.end = 21;
      if (invalid === 'extra-key') Object.assign(detail, { storageKey: MOVIE_KEY });
      objects.set(`${PREFIX}/forrest-gump/material.json`, JSON.stringify(detail));
      await expect(getPlatformMaterial(env, 'forrest-gump')).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE' });
    });

  it('超大摘要流立即取消，不能通过伪报对象长度绕过内存上限', async () => {
    const { env } = fixture();
    const cancel = vi.fn();
    env.SPEAKING_BUCKET!.get = vi.fn(async () => ({
      size: 100, etag: 'test', httpEtag: '"test"',
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel,
      }),
    }));
    await expect(getPlatformCatalog(env)).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('未匹配的私有路径或写入请求不会被公开目录处理', async () => {
    const { env, get } = fixture();
    expect(await handlePublicSpeakingRoute(new Request('https://api.test/v1/speaking/library'), env)).toBeNull();
    expect(await handlePublicSpeakingRoute(new Request('https://api.test/v1/speaking/catalog', { method: 'POST' }), env)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('固定素材的内存缓存', () => {
  it('同一个 Durable Object 再次打开同一素材时不再读取 R2，也不再校验字幕', async () => {
    const { env, get } = fixture();
    await getPlatformMaterial(env, 'forrest-gump');
    await getPlatformMaterial(env, 'forrest-gump');
    await getPlatformCatalog(env);
    expect(get.mock.calls).toEqual([[`${PREFIX}/catalog.json`], [`${PREFIX}/forrest-gump/material.json`]]);
  });

  it('目录缓存一分钟后重新读取，发布新版本的字幕后读取新版本', async () => {
    vi.useFakeTimers();
    try {
      const { env, get, objects, entries, details } = fixture();
      await getPlatformMaterial(env, 'titanic');
      const updated = { ...details[4]!, revision: 2, cues: [{ ...details[4]!.cues[0]!, en: 'A new line.' }] };
      objects.set(`${PREFIX}/titanic/material.json`, JSON.stringify(updated));
      objects.set(`${PREFIX}/catalog.json`, JSON.stringify({ materials: entries.map(entry =>
        entry.material.id === 'titanic' ? { ...entry, material: { ...entry.material, revision: 2 } } : entry) }));
      expect((await getPlatformMaterial(env, 'titanic')).revision).toBe(1);
      vi.advanceTimersByTime(61_000);
      expect((await getPlatformMaterial(env, 'titanic')).cues[0]!.en).toBe('A new line.');
      expect(get).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

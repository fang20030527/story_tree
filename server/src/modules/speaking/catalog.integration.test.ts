import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { SpeakingCatalogDtoSchema, SpeakingLibraryDtoSchema, SpeakingMaterialDtoSchema, SpeakingPlaybackDtoSchema } from '@context-reader/contracts';
import { withTestDatabase } from '../../../test/database';
import { loadConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import { speakingAssets, speakingMaterials } from '../../db/schema';
import type { MediaStore } from '../../infrastructure/media/store';
import { registerAnonymous } from '../auth/service';
import { speakingRoutes } from './routes';

const OWNER_TOKEN = 'b1'.repeat(32);
const OTHER_TOKEN = 'b2'.repeat(32);
const sharedFilm = {
  id: 'film-shared', title: 'A shared movie', subtitle: '固定素材', category: '电影对白',
  sourceKind: 'platform', mediaType: 'video', assetId: null, videoId: null,
  duration: 60, revision: 1, createdAt: '2026-10-01T08:00:00.000Z',
  cues: [{ id: 'public-cue', start: 1, end: 3, en: 'The original shared sentence.', zh: '公开原字幕。' }],
};

describe('所有用户可见的口语固定电影', () => {
  it('来宾公开读取和签名播放，个人字幕覆盖不污染共享目录或另一账号', async () => {
    const root = await mkdtemp(join(tmpdir(), 'speaking-catalog-integration-'));
    try {
      const catalogPath = join(root, 'catalog.json');
      await writeFile(catalogPath, JSON.stringify({ materials: [{ id: 'demo-audio', title: 'Original audio', subtitle: '',
        category: '日常表达', duration: 10, cues: [{ id: 'demo-cue', start: 0, end: 2, en: 'Hello there.', zh: '' }] }] }));
      const storageKey = 'speaking/platform/film-shared/source.mp4';
      await writeFile(join(root, 'cloud-catalog.json'), JSON.stringify({ materials: [{ material: sharedFilm,
        media: { storageKey, byteSize: 1234, contentType: 'video/mp4', sha256: 'a'.repeat(64) } }] }));
      await withTestDatabase(async ({ db }) => {
        await registerAnonymous(db, OWNER_TOKEN, true);
        await registerAnonymous(db, OTHER_TOKEN, true);
        const config = loadConfig({ DATABASE_URL: 'postgresql://example.invalid/db', EVOLINK_API_KEY: 'test-only',
          PUBLIC_SERVER_ORIGIN: 'http://localhost:3000', SPEAKING_STORAGE_DRIVER: 'disabled' });
        const signedReadUrl = vi.fn().mockResolvedValue('https://example.invalid/shared.mp4?signature=test-only');
        const app = Fastify({ logger: false });
        app.decorateRequest('authUser');
        app.setErrorHandler((error, _request, reply) => {
          const known = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', '测试请求失败', 500);
          return reply.status(known.statusCode).send({ error: { code: known.code } });
        });
        app.register(speakingRoutes, { db, config, catalogPath, mediaStore: { driver: 'r2', signedReadUrl } as unknown as MediaStore });
        try {
          const publicList = await app.inject({ method: 'GET', url: '/v1/speaking/catalog' });
          expect(publicList.statusCode).toBe(200);
          const list = SpeakingCatalogDtoSchema.parse(publicList.json());
          expect(list.materials.map(value => value.id)).toEqual(['demo-audio', 'film-shared']);
          expect(publicList.body).not.toContain('storageKey');
          expect(publicList.body).not.toContain('public-cue');
          const detail = await app.inject({ method: 'GET', url: '/v1/speaking/catalog/film-shared' });
          expect(SpeakingMaterialDtoSchema.parse(detail.json())).toEqual(sharedFilm);
          expect(detail.body).not.toContain(storageKey);
          const playback = await app.inject({ method: 'GET', url: '/v1/speaking/catalog/film-shared/playback' });
          expect(playback.statusCode).toBe(200);
          expect(playback.headers['cache-control']).toBe('no-store');
          expect(SpeakingPlaybackDtoSchema.parse(playback.json()).url).toContain('signature=test-only');
          expect(signedReadUrl).toHaveBeenCalledWith(storageKey, 3600);
          expect((await app.inject({ method: 'GET', url: '/v1/speaking/catalog/demo-audio/playback' })).statusCode).toBe(404);
          expect((await app.inject({ method: 'GET', url: '/v1/speaking/catalog/missing' })).statusCode).toBe(404);
          expect((await app.inject({ method: 'PATCH', url: '/v1/speaking/catalog/film-shared', payload: {} })).statusCode).toBe(404);
          expect((await app.inject({ method: 'GET', url: '/v1/speaking/library' })).statusCode).toBe(401);
          const privateCues = [{ ...sharedFilm.cues[0]!, en: 'Only this account corrected the line.' }];
          const privatePatch = await app.inject({ method: 'PATCH', url: '/v1/speaking/materials/film-shared/subtitles',
            headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'idempotency-key': crypto.randomUUID() },
            payload: { revision: 1, cues: privateCues } });
          expect(privatePatch.statusCode).toBe(200);
          expect(SpeakingMaterialDtoSchema.parse(privatePatch.json()).cues).toEqual(privateCues);
          const owner = await app.inject({ method: 'GET', url: '/v1/speaking/materials/film-shared', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
          const other = await app.inject({ method: 'GET', url: '/v1/speaking/materials/film-shared', headers: { authorization: `Bearer ${OTHER_TOKEN}` } });
          const publicAfter = await app.inject({ method: 'GET', url: '/v1/speaking/catalog/film-shared', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
          expect(SpeakingMaterialDtoSchema.parse(owner.json()).revision).toBe(2);
          expect(SpeakingMaterialDtoSchema.parse(other.json())).toEqual(sharedFilm);
          expect(SpeakingMaterialDtoSchema.parse(publicAfter.json())).toEqual(sharedFilm);
          const library = await app.inject({ method: 'GET', url: '/v1/speaking/library', headers: { authorization: `Bearer ${OWNER_TOKEN}` } });
          expect(SpeakingLibraryDtoSchema.parse(library.json()).materials).toContainEqual(expect.objectContaining({ id: 'film-shared', sourceKind: 'platform', assetId: null }));
          expect(await db.select().from(speakingMaterials)).toHaveLength(0);
          expect(await db.select().from(speakingAssets)).toHaveLength(0);
        } finally {
          await app.close();
        }
      });
    } finally {
      await removeTestDirectory(root);
    }
  });
});

async function removeTestDirectory(root: string) {
  const absolute = resolve(root);
  const child = relative(resolve(tmpdir()), absolute);
  if (!child || child.startsWith('..') || isAbsolute(child) || !basename(absolute).startsWith('speaking-catalog-integration-')) throw new Error('测试目录清理范围无效');
  await rm(absolute, { recursive: true, force: true });
}

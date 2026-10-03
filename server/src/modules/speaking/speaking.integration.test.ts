import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import {
  SpeakingAssetDtoSchema,
  SpeakingCapabilitiesDtoSchema,
  SpeakingCatalogDtoSchema,
  SpeakingLibraryDtoSchema,
  SpeakingMaterialDtoSchema,
  SpeakingPlaybackDtoSchema,
  SpeakingSessionDtoSchema,
  SpeakingStateDtoSchema,
} from '@context-reader/contracts';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { speakingAssets, speakingStorageCleanup } from '../../db/schema';
import { createMediaStore } from '../../infrastructure/media/store';
import { registerAnonymous } from '../auth/service';
import { sweepSpeakingAssets } from './assets';
import * as remoteMediaNode from './remote-media-node';

const OWNER_TOKEN = 'a1'.repeat(32);
const OTHER_TOKEN = 'a2'.repeat(32);
const PRIVATE_TEXT = 'A private synthetic sentence for shadowing.';
const cues = [
  { id: 'line-1', start: 1, end: 3, en: PRIVATE_TEXT, zh: '测试字幕。' },
  { id: 'line-2', start: 2, end: 4, en: 'Overlapping film dialogue.', zh: '' },
];
const subtitles = [
  '1', '00:00:01,000 --> 00:00:03,000', PRIVATE_TEXT, '测试字幕。', '',
  '2', '00:00:02,000 --> 00:00:04,000', 'Overlapping film dialogue.', '',
].join('\n');

function wavFixture(): Buffer {
  const pcm = Buffer.alloc(160);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8_000, 24);
  header.writeUInt32LE(16_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function headers(token = OWNER_TOKEN, key?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(key ? { 'idempotency-key': key } : {}),
  };
}

async function request(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  body?: unknown,
  token = OWNER_TOKEN,
  key = crypto.randomUUID(),
) {
  return app.inject({
    method, url, headers: headers(token, body === undefined ? undefined : key),
    ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { ...headers(token, key), 'content-type': 'application/json' } }),
  });
}

async function uploadAsset(app: FastifyInstance, purpose: 'material' | 'recording' = 'material', token = OWNER_TOKEN) {
  const bytes = wavFixture();
  const created = await request(app, 'POST', '/v1/speaking/assets', {
    contentType: 'audio/wav', byteSize: bytes.length, purpose,
  }, token);
  expect([200, 201]).toContain(created.statusCode);
  const asset = SpeakingAssetDtoSchema.parse(created.json());
  const uploaded = await app.inject({
    method: 'PUT', url: asset.uploadPath,
    headers: { ...headers(token), 'content-type': 'audio/wav', 'content-length': String(bytes.length) },
    payload: bytes,
  });
  expect(uploaded.statusCode).toBe(200);
  const ready = SpeakingAssetDtoSchema.parse(uploaded.json());
  expect(ready.status).toBe('ready');
  return { asset: ready, bytes };
}

async function removeTestDirectory(path: string): Promise<void> {
  const absolute = resolve(path);
  const nested = relative(resolve(tmpdir()), absolute);
  if (!nested || nested.startsWith('..') || isAbsolute(nested) || !basename(absolute).startsWith('speaking-integration-')) {
    throw new Error('测试目录清理范围无效');
  }
  await rm(absolute, { recursive: true, force: true });
}

describe('已有字幕的口语练习 API', () => {
  it('仅为已认证用户读取网页媒体，返回完整二进制且不创建上传资产', async () => {
    const bytes = wavFixture();
    const close = vi.fn(async () => undefined);
    const open = vi.spyOn(remoteMediaNode, 'openSpeakingRemoteUrlOnNode').mockImplementation(async url => ({
      url: new URL(url), response: new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/wav', 'set-cookie': 'private=value' } }), close,
    }));
    try {
      await withTestDatabase(async ({ db }) => {
        await registerAnonymous(db, OWNER_TOKEN, true);
        const config = loadConfig({ DATABASE_URL: 'postgresql://example.invalid/db', EVOLINK_API_KEY: 'test-key', PUBLIC_SERVER_ORIGIN: 'http://localhost:3000' });
        const app = buildApp({ config, db, logger: false });
        try {
          const url = '/v1/speaking/remote-media';
          expect((await app.inject({ method: 'POST', url, payload: { url: 'https://example.com/audio' } })).statusCode).toBe(401);
          expect((await request(app, 'POST', url, { url: 'invalid-url' })).statusCode).toBe(400);
          expect(open).not.toHaveBeenCalled();
          const response = await request(app, 'POST', url, { url: 'https://example.com/audio' });
          expect(response.statusCode).toBe(200); expect(response.rawPayload).toEqual(bytes);
          expect(response.headers['content-type']).toBe('audio/wav'); expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers['set-cookie']).toBeUndefined(); expect(close).toHaveBeenCalledTimes(1);
          expect(await db.select().from(speakingAssets)).toHaveLength(0);
        } finally { await app.close(); }
      });
    } finally { open.mockRestore(); }
  });

  it('隔离私有媒体、保存字幕与练习进度，并提供受限的签名 Range 播放', async () => {
    const root = await mkdtemp(join(tmpdir(), 'speaking-integration-'));
    const logs: string[] = [];
    try {
      await withTestDatabase(async ({ db }) => {
        await registerAnonymous(db, OWNER_TOKEN, true);
        await registerAnonymous(db, OTHER_TOKEN, true);
        const config = loadConfig({
          DATABASE_URL: 'postgresql://example.invalid/db',
          EVOLINK_API_KEY: 'test-ai-secret',
          PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
          SPEAKING_STORAGE_DRIVER: 'local', SPEAKING_MEDIA_ROOT: root,
          SPEAKING_PLAYBACK_SIGNING_KEY: 'test-playback-secret-with-32-characters',
        });
        const mediaStore = createMediaStore({ driver: 'local', localRoot: join(root, 'store') });
        const mediaProcessor = {
          probe: async () => ({ durationSeconds: 60, hasAudio: true, mediaType: 'audio' as const }),
        };
        const app = buildApp({
          config, db,
          loggerStream: { write: (value: string) => { logs.push(value); } },
          speakingMediaStore: mediaStore,
          speakingMediaProcessor: mediaProcessor,
        });
        try {
          expect((await app.inject({ method: 'GET', url: '/v1/speaking/library' })).statusCode).toBe(401);
          const capabilities = await request(app, 'GET', '/v1/speaking/capabilities');
          expect(capabilities.statusCode).toBe(200);
          expect(SpeakingCapabilitiesDtoSchema.parse(capabilities.json()).autoSubtitles).toBe(false);

          const { asset, bytes } = await uploadAsset(app);
          const replay = await app.inject({
            method: 'PUT', url: asset.uploadPath,
            headers: { ...headers(), 'content-type': 'audio/wav', 'content-length': String(bytes.length) }, payload: bytes,
          });
          expect(replay.statusCode).toBe(200);
          const different = Buffer.from(bytes);
          different[different.length - 1] = 1;
          const changedBytes = await app.inject({
            method: 'PUT', url: asset.uploadPath,
            headers: { ...headers(), 'content-type': 'audio/wav', 'content-length': String(different.length) }, payload: different,
          });
          expect(changedBytes.statusCode).toBe(409);
          expect((await request(app, 'GET', `/v1/speaking/assets/${asset.id}/playback`, undefined, OTHER_TOKEN)).statusCode).toBe(404);

          const createKey = crypto.randomUUID();
          const input = { sourceKind: 'file', assetId: asset.id, title: 'Private practice', cues };
          const created = await request(app, 'POST', '/v1/speaking/materials', input, OWNER_TOKEN, createKey);
          expect([200, 201]).toContain(created.statusCode);
          const material = SpeakingMaterialDtoSchema.parse(created.json());
          expect(material.duration).toBe(60);
          expect(material.revision).toBe(1);
          const stateUrl = `/v1/speaking/materials/${material.id}/state`;
          const beforeSubtitlesState = SpeakingStateDtoSchema.parse((await request(app, 'GET', stateUrl)).json());
          const creationReplay = await request(app, 'POST', '/v1/speaking/materials', input, OWNER_TOKEN, createKey);
          expect(creationReplay.json()).toEqual(created.json());
          expect((await request(app, 'GET', `/v1/speaking/materials/${material.id}`, undefined, OTHER_TOKEN)).statusCode).toBe(404);
          expect((await request(app, 'POST', '/v1/speaking/materials', input, OTHER_TOKEN)).statusCode).toBe(404);
          expect((await app.inject({
            method: 'PATCH', url: `/v1/speaking/materials/${material.id}/subtitles`,
            headers: headers(), payload: { revision: 1, cues },
          })).statusCode).toBe(400);

          const importKey = crypto.randomUUID();
          const importInput = { revision: 1, format: 'srt', text: subtitles };
          const imported = await request(app, 'POST', `/v1/speaking/materials/${material.id}/subtitles/import`, importInput, OWNER_TOKEN, importKey);
          expect(imported.statusCode).toBe(200);
          const importedMaterial = SpeakingMaterialDtoSchema.parse(imported.json());
          expect(importedMaterial.revision).toBe(2);
          expect(importedMaterial.cues).toHaveLength(2);
          expect(importedMaterial.cues[0]?.en).toBe(PRIVATE_TEXT);
          expect((await request(app, 'POST', `/v1/speaking/materials/${material.id}/subtitles/import`, importInput, OWNER_TOKEN, importKey)).json()).toEqual(imported.json());
          expect((await request(app, 'PATCH', `/v1/speaking/materials/${material.id}/subtitles`, { revision: 1, cues })).statusCode).toBe(409);

          const correctedCues = importedMaterial.cues.map((cue, index) => index ? cue : { ...cue, zh: '经过校正的测试字幕。' });
          const corrected = await request(app, 'PATCH', `/v1/speaking/materials/${material.id}/subtitles`, { revision: 2, cues: correctedCues });
          expect(corrected.statusCode).toBe(200);
          expect(SpeakingMaterialDtoSchema.parse(corrected.json()).revision).toBe(3);
          expect((await request(app, 'PATCH', stateUrl, { revision: beforeSubtitlesState.revision, position: 2 })).statusCode).toBe(409);

          const state = SpeakingStateDtoSchema.parse((await request(app, 'GET', stateUrl)).json());
          expect(state.revision).toBeGreaterThanOrEqual(0);
          const cueId = correctedCues[0]!.id;
          const stateInput = { revision: state.revision, savedCueIds: [cueId], notes: { [cueId]: '练习重音与停顿。' }, position: 2 };
          const stateKey = crypto.randomUUID();
          const savedState = await request(app, 'PATCH', stateUrl, stateInput, OWNER_TOKEN, stateKey);
          expect(savedState.statusCode).toBe(200);
          const updatedState = SpeakingStateDtoSchema.parse(savedState.json());
          expect(updatedState).toMatchObject({ revision: state.revision + 1, notes: stateInput.notes, savedCueIds: [cueId] });
          expect((await request(app, 'PATCH', stateUrl, stateInput, OWNER_TOKEN, stateKey)).json()).toEqual(savedState.json());
          expect((await request(app, 'PATCH', stateUrl, stateInput)).statusCode).toBe(409);
          expect((await request(app, 'GET', stateUrl, undefined, OTHER_TOKEN)).statusCode).toBe(404);
          expect((await request(app, 'PATCH', stateUrl, { revision: updatedState.revision, savedCueIds: ['missing-cue'] })).statusCode).toBe(400);

          const otherRecording = await uploadAsset(app, 'recording', OTHER_TOKEN);
          const beforeForeignRecording = SpeakingStateDtoSchema.parse((await request(app, 'GET', stateUrl)).json());
          expect((await request(app, 'PATCH', stateUrl, {
            revision: beforeForeignRecording.revision, recording: { assetId: otherRecording.asset.id, cueId, durationMs: 60_000 },
          })).statusCode).toBe(404);
          const ownerRecording = await uploadAsset(app, 'recording');
          const beforeOwnerRecording = SpeakingStateDtoSchema.parse((await request(app, 'GET', stateUrl)).json());
          const recorded = await request(app, 'PATCH', stateUrl, {
            revision: beforeOwnerRecording.revision, recording: { assetId: ownerRecording.asset.id, cueId, durationMs: 60_000 },
          });
          expect(recorded.statusCode).toBe(200);

          const sessionId = crypto.randomUUID();
          const sessionUrl = `/v1/speaking/sessions/${sessionId}`;
          const sessionInput = { materialId: material.id, date: new Date(Date.now() - 60_000).toISOString(), elapsedMs: 12_000, cueCount: 2, position: 3 };
          const sessionSaved = await request(app, 'PUT', sessionUrl, sessionInput);
          expect(sessionSaved.statusCode).toBe(200);
          expect(SpeakingSessionDtoSchema.parse(sessionSaved.json()).elapsedMs).toBe(12_000);
          const staleSession = await request(app, 'PUT', sessionUrl, { ...sessionInput, elapsedMs: 6_000, cueCount: 1, position: 1 });
          expect(staleSession.statusCode).toBe(200);
          expect(SpeakingSessionDtoSchema.parse(staleSession.json()).elapsedMs).toBe(12_000);
          expect((await request(app, 'PUT', sessionUrl, sessionInput, OTHER_TOKEN)).statusCode).toBe(404);

          const olderSession = await request(app, 'PUT', `/v1/speaking/sessions/${crypto.randomUUID()}`, {
            ...sessionInput, date: new Date(new Date(sessionInput.date).getTime() - 3_600_000).toISOString(), elapsedMs: 5_000, position: 1,
          });
          expect(olderSession.statusCode).toBe(200);

          const currentState = SpeakingStateDtoSchema.parse((await request(app, 'GET', stateUrl)).json());
          expect(currentState.position).toBe(3);
          const concurrent = await Promise.all([
            request(app, 'PATCH', stateUrl, { revision: currentState.revision, position: 4 }),
            request(app, 'PATCH', stateUrl, { revision: currentState.revision, position: 5 }),
          ]);
          expect(concurrent.map(response => response.statusCode).sort()).toEqual([200, 409]);

          const library = SpeakingLibraryDtoSchema.parse((await request(app, 'GET', '/v1/speaking/library')).json());
          expect(library.sessions.filter(({ id }) => id === sessionId)).toHaveLength(1);
          const sharedCatalog = SpeakingCatalogDtoSchema.parse((await request(app, 'GET', '/v1/speaking/catalog')).json());
          expect(library.materials.filter(({ sourceKind }) => sourceKind === 'platform').map(({ id }) => id))
            .toEqual(sharedCatalog.materials.map(({ id }) => id));
          const otherLibrary = SpeakingLibraryDtoSchema.parse((await request(app, 'GET', '/v1/speaking/library', undefined, OTHER_TOKEN)).json());
          expect(otherLibrary.materials.some(({ id }) => id === material.id)).toBe(false);
          expect(otherLibrary.states.some(({ materialId }) => materialId === material.id)).toBe(false);

          expect(library.nextCursor).toBeNull();
          expect(library.materials.every(summary => !('cues' in summary) && 'cueCount' in summary)).toBe(true);
          const platformSummary = library.materials.find(({ sourceKind }) => sourceKind === 'platform')!;
          const platform = SpeakingMaterialDtoSchema.parse((await request(app, 'GET', `/v1/speaking/materials/${platformSummary.id}`)).json());
          const personalPlatform = await request(app, 'PATCH', `/v1/speaking/materials/${platform.id}/subtitles`, { revision: platform.revision, cues });
          expect(personalPlatform.statusCode).toBe(200);
          const untouched = SpeakingMaterialDtoSchema.parse((await request(app, 'GET', `/v1/speaking/materials/${platform.id}`, undefined, OTHER_TOKEN)).json());
          expect(untouched.cues).toEqual(platform.cues);

          const youtube = await request(app, 'POST', '/v1/speaking/materials', {
            sourceKind: 'youtube', videoId: 'M7lc1UVf-VE', title: 'Synthetic YouTube subtitles', duration: 60, cues,
          });
          expect([200, 201]).toContain(youtube.statusCode);
          expect(SpeakingMaterialDtoSchema.parse(youtube.json())).toMatchObject({ sourceKind: 'youtube', videoId: 'M7lc1UVf-VE', assetId: null });

          const playbackResponse = await request(app, 'GET', `/v1/speaking/assets/${asset.id}/playback`);
          expect(playbackResponse.statusCode).toBe(200);
          const playback = SpeakingPlaybackDtoSchema.parse(playbackResponse.json());
          const playbackUrl = new URL(playback.url);
          const path = `${playbackUrl.pathname}${playbackUrl.search}`;
          for (const start of [0, 64, bytes.length - 8]) {
            const end = Math.min(start + 7, bytes.length - 1);
            const range = await app.inject({ method: 'GET', url: path, headers: { range: `bytes=${start}-${end}` } });
            expect(range.statusCode).toBe(206);
            expect(range.headers['content-range']).toBe(`bytes ${start}-${end}/${bytes.length}`);
            expect(range.rawPayload).toEqual(bytes.subarray(start, end + 1));
          }
          for (const range of ['bytes=-8', `bytes=${bytes.length - 8}-`]) {
            const partial = await app.inject({ method: 'GET', url: path, headers: { range } });
            expect(partial.statusCode).toBe(206);
            expect(partial.rawPayload).toEqual(bytes.subarray(-8));
          }
          const head = await app.inject({ method: 'HEAD', url: path });
          expect(head.statusCode).toBe(200);
          expect(head.headers['content-length']).toBe(String(bytes.length));
          expect(head.rawPayload.length).toBe(0);
          expect((await app.inject({ method: 'GET', url: path, headers: { range: `bytes=${bytes.length}-` } })).statusCode).toBe(416);
          const signedValues = [...playbackUrl.searchParams.values()];
          const tamperedUrl = new URL(playback.url);
          const firstParameter = [...tamperedUrl.searchParams.keys()][0]!;
          tamperedUrl.searchParams.set(firstParameter, `${tamperedUrl.searchParams.get(firstParameter)}x`);
          expect((await app.inject({ method: 'GET', url: `${tamperedUrl.pathname}${tamperedUrl.search}` })).statusCode).toBeGreaterThanOrEqual(400);
          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(new Date(new Date(playback.expiresAt).getTime() + 1_000));
          try {
            expect((await app.inject({ method: 'GET', url: path })).statusCode).toBeGreaterThanOrEqual(400);
          } finally {
            vi.useRealTimers();
          }

          const [orphan] = await db.select().from(speakingAssets).where(eq(speakingAssets.id, otherRecording.asset.id));
          expect(orphan?.attachedAt).toBeNull();
          const orphanKey = orphan!.storageKey!;
          await db.update(speakingAssets).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(speakingAssets.id, otherRecording.asset.id));
          const deleteFailure = vi.spyOn(mediaStore, 'delete').mockRejectedValueOnce(new Error('synthetic storage unavailable'));
          try {
            // 旧录音的存储清理不可用时，仍可预留下一次上传，避免 R2 超时阻塞用户操作。
            const intent = await request(app, 'POST', '/v1/speaking/assets', {
              contentType: 'audio/wav', byteSize: bytes.length, purpose: 'recording',
            });
            expect(intent.statusCode).toBe(201);
            expect(deleteFailure).not.toHaveBeenCalled();
            await sweepSpeakingAssets({ db, config, mediaStore, mediaProcessor });
            expect(await mediaStore.stat(orphanKey)).not.toBeNull();
            const pending = await db.select().from(speakingStorageCleanup).where(eq(speakingStorageCleanup.storageKey, orphanKey));
            expect(pending).toHaveLength(1);
            expect(pending[0]!.notBefore.getTime()).toBeGreaterThan(Date.now());
          } finally {
            deleteFailure.mockRestore();
          }
          await db.update(speakingStorageCleanup).set({ notBefore: new Date(Date.now() - 1_000) }).where(eq(speakingStorageCleanup.storageKey, orphanKey));
          await sweepSpeakingAssets({ db, config, mediaStore, mediaProcessor });
          expect(await mediaStore.stat(orphanKey)).toBeNull();
          expect(await db.select().from(speakingStorageCleanup).where(eq(speakingStorageCleanup.storageKey, orphanKey))).toHaveLength(0);
          const logText = logs.join('');
          for (const secret of [OWNER_TOKEN, OTHER_TOKEN, PRIVATE_TEXT, root, 'test-ai-secret', 'test-playback-secret-with-32-characters', ...signedValues.filter(value => value.length > 20)]) {
            expect(logText).not.toContain(secret);
          }
        } finally {
          vi.useRealTimers();
          await app.close();
        }
      });
    } finally {
      await removeTestDirectory(root);
    }
  }, 180_000);
});

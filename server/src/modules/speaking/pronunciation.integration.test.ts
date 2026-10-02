import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { SpeakingPronunciationAssessmentDtoSchema, type CreateSpeakingPronunciationRequest, type SpeakingMaterialDto, type SpeakingPronunciationResult } from '@context-reader/contracts';
import { withTestDatabase } from '../../../test/database';
import { loadConfig } from '../../config/env';
import { speakingAssets, speakingPronunciationAssessments, users } from '../../db/schema';
import type { AppDatabase } from '../../db/client';
import type { MediaStore } from '../../infrastructure/media/store';
import { createSpeakingPronunciationAssessment, getSpeakingPronunciationAssessment } from './pronunciation';
import { pronunciationFingerprint } from './pronunciation-shared';
import { registerAnonymous } from '../auth/service';
import { buildApp } from '../../app';

const result: SpeakingPronunciationResult = { score: 82, words: [
  { word: 'Stay', score: 80, startMs: 100, endMs: 700, phonemes: [{ symbol: 's', spokenSymbol: 's', score: 80, stressScore: null, startMs: 100, endMs: 200 }] },
  { word: 'curious', score: 85, startMs: 800, endMs: 1600, phonemes: [] },
], feedback: ['留意 curious 的重音，再跟着原音读一次。'] };
const material: SpeakingMaterialDto = { id: 'test-platform', title: '测试素材', subtitle: '', category: '测试', sourceKind: 'platform', mediaType: 'audio',
  assetId: null, videoId: null, duration: 60, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', cues: [{ id: 'line-one', start: 0, end: 2, en: 'Stay curious.', zh: '' }] };
const config = () => loadConfig({ DATABASE_URL: 'postgresql://test.invalid/db', EVOLINK_API_KEY: 'fake-test-key', PUBLIC_SERVER_ORIGIN: 'http://localhost:3000' });
const audio = new Uint8Array(44);
function mediaStore(): MediaStore {
  return { driver: 'local', putFile: vi.fn(), downloadFile: vi.fn(), stat: vi.fn(), delete: vi.fn(),
    openRead: vi.fn(async () => Readable.from([audio])) };
}
async function seed(db: AppDatabase) {
  const [owner, other, guest] = await db.insert(users).values([
    { kind: 'registered', ageConfirmedAt: new Date() }, { kind: 'registered', ageConfirmedAt: new Date() }, { kind: 'guest', ageConfirmedAt: new Date() },
  ]).returning();
  if (!owner || !other || !guest) throw new Error('测试用户创建失败');
  const [asset] = await db.insert(speakingAssets).values({ userId: owner.id, purpose: 'recording', status: 'ready',
    contentType: 'audio/wav', byteSize: audio.byteLength, duration: 2, mediaType: 'audio', storageKey: 'private/test-recording',
    expiresAt: new Date(Date.now() + 86_400_000), attachedAt: new Date() }).returning();
  if (!asset) throw new Error('测试录音创建失败');
  const request: CreateSpeakingPronunciationRequest = { assetId: asset.id, materialId: material.id, cueId: 'line-one', referenceText: 'Stay curious.', subtitleRevision: 1, locale: 'en-us' };
  return { owner, other, guest, asset, request };
}

describe('逐句发音评分 PostgreSQL', () => {
  it('同键与不同键并发只占有一次调用，成功缓存不受额度或资产清理影响', async () => {
    await withTestDatabase(async ({ db }) => {
      const { owner, other, guest, asset, request } = await seed(db);
      let started!: () => void; let finish!: (value: SpeakingPronunciationResult) => void;
      const inProvider = new Promise<void>(resolve => { started = resolve; });
      const deferred = new Promise<SpeakingPronunciationResult>(resolve => { finish = resolve; });
      const provider = { assess: vi.fn(async () => { started(); return deferred; }) };
      const deps = { db, config: { ...config(), SPEECHACE_DAILY_LIMIT: 1 }, catalog: new Map([[material.id, material]]), mediaStore: mediaStore(), pronunciationProvider: provider };
      const key = crypto.randomUUID();
      const first = createSpeakingPronunciationAssessment(deps, owner.id, key, request);
      await inProvider;
      const [sameKey, differentKey] = await Promise.all([
        createSpeakingPronunciationAssessment(deps, owner.id, key, request),
        createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request),
      ]);
      expect(sameKey.status).toBe('processing'); expect(differentKey.id).toBe(sameKey.id);
      expect(provider.assess).toHaveBeenCalledTimes(1);
      finish(result);
      const ready = await first;
      expect(SpeakingPronunciationAssessmentDtoSchema.parse(ready).result).toEqual(result);
      await expect(getSpeakingPronunciationAssessment(deps, other.id, ready.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(createSpeakingPronunciationAssessment(deps, guest.id, crypto.randomUUID(), request)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(createSpeakingPronunciationAssessment(deps, other.id, crypto.randomUUID(), request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(createSpeakingPronunciationAssessment(deps, owner.id, key, { ...request, locale: 'en-gb' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, locale: 'en-gb' })).rejects.toMatchObject({ code: 'PRONUNCIATION_LIMIT_REACHED' });
      await db.delete(speakingAssets).where(eq(speakingAssets.id, asset.id));
      expect((await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request)).id).toBe(ready.id);
      expect(provider.assess).toHaveBeenCalledTimes(1);
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, owner.id));
      await expect(getSpeakingPronunciationAssessment(deps, owner.id, ready.id)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
  it('校验字幕、音频和服务配置；失败重放保持结果，明确重试用新键', async () => {
    await withTestDatabase(async ({ db }) => {
      const { owner, asset, request } = await seed(db);
      const provider = { assess: vi.fn().mockRejectedValueOnce(new Error('private-upstream-key-and-audio')).mockResolvedValue(result) };
      const deps = { db, config: config(), catalog: new Map([[material.id, material]]), mediaStore: mediaStore(), pronunciationProvider: provider };
      await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, subtitleRevision: 2 })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, referenceText: 'Another sentence.' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      await db.update(speakingAssets).set({ duration: 31 }).where(eq(speakingAssets.id, asset.id));
      await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request)).rejects.toMatchObject({ code: 'PRONUNCIATION_AUDIO_INVALID' });
      await db.update(speakingAssets).set({ duration: 2 }).where(eq(speakingAssets.id, asset.id));
      const unconfigured = { db, config: config(), catalog: deps.catalog, mediaStore: deps.mediaStore };
      await expect(createSpeakingPronunciationAssessment(unconfigured, owner.id, crypto.randomUUID(), request)).rejects.toMatchObject({ code: 'PRONUNCIATION_NOT_CONFIGURED' });
      const key = crypto.randomUUID();
      const failed = await createSpeakingPronunciationAssessment(deps, owner.id, key, request);
      expect(failed.status).toBe('failed'); expect(failed.error?.retryable).toBe(true);
      expect(JSON.stringify(failed)).not.toContain('private-upstream-key-and-audio');
      expect((await createSpeakingPronunciationAssessment(deps, owner.id, key, request)).id).toBe(failed.id);
      expect(provider.assess).toHaveBeenCalledTimes(1);
      const ready = await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request);
      expect(ready.status).toBe('ready'); expect(ready.id).not.toBe(failed.id);
      expect(provider.assess).toHaveBeenCalledTimes(2);
      await db.update(speakingPronunciationAssessments).set({ status: 'failed', result: null, error: { code: 'PRONUNCIATION_NO_SPEECH', message: '没有听到清晰的英语，请重新录音', retryable: false } })
        .where(eq(speakingPronunciationAssessments.id, ready.id));
      const staleId = crypto.randomUUID();
      await db.insert(speakingPronunciationAssessments).values({ id: staleId, userId: owner.id, ...request,
        fingerprint: await pronunciationFingerprint(request), deadlineAt: new Date(Date.now() - 1000) });
      expect((await getSpeakingPronunciationAssessment(deps, owner.id, staleId)).status).toBe('failed');
      expect(provider.assess).toHaveBeenCalledTimes(2);
    });
  });
  it('读取期间失效的旧请求不重复调用上游；超过处理时限的迟到结果不保存为成功', async () => {
    await withTestDatabase(async ({ db }) => {
      const { owner, request } = await seed(db);
      let started!: () => void; let release!: (stream: Readable) => void;
      const reading = new Promise<void>(resolve => { started = resolve; });
      const delayed = new Promise<Readable>(resolve => { release = resolve; });
      const store = mediaStore();
      store.openRead = vi.fn().mockImplementationOnce(async () => { started(); return delayed; })
        .mockImplementation(async () => Readable.from([audio]));
      const provider = { assess: vi.fn(async () => result) };
      const deps = { db, config: config(), catalog: new Map([[material.id, material]]), mediaStore: store, pronunciationProvider: provider };
      const first = createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request);
      await reading;
      const [old] = await db.select().from(speakingPronunciationAssessments).where(eq(speakingPronunciationAssessments.userId, owner.id));
      if (!old) throw new Error('缺少处理中评分');
      await db.update(speakingPronunciationAssessments).set({ deadlineAt: new Date(Date.now() - 1000) }).where(eq(speakingPronunciationAssessments.id, old.id));
      expect((await getSpeakingPronunciationAssessment(deps, owner.id, old.id)).status).toBe('failed');
      expect(provider.assess).not.toHaveBeenCalled();
      const ready = await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request);
      expect(ready.status).toBe('ready');
      release(Readable.from([audio]));
      expect((await first).id).toBe(old.id); expect((await first).status).toBe('failed');
      expect(provider.assess).toHaveBeenCalledTimes(1);
      provider.assess.mockImplementationOnce(async () => {
        await db.update(speakingPronunciationAssessments).set({ deadlineAt: new Date(Date.now() - 1000) })
          .where(and(eq(speakingPronunciationAssessments.userId, owner.id), eq(speakingPronunciationAssessments.status, 'processing')));
        return result;
      });
      const late = await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, locale: 'en-gb' });
      expect(late.status).toBe('failed'); expect(late.result).toBeNull(); expect(late.error?.retryable).toBe(true);
      expect(provider.assess).toHaveBeenCalledTimes(2);
    });
  });
  it('按服务端 UTC 日期记录新尝试，跨日恢复额度，历史成功缓存不计入新日次数', async () => {
    await withTestDatabase(async ({ db }) => {
      const { owner, request } = await seed(db);
      const provider = { assess: vi.fn(async () => result) };
      const deps = { db, config: { ...config(), SPEECHACE_DAILY_LIMIT: 1 }, catalog: new Map([[material.id, material]]), mediaStore: mediaStore(), pronunciationProvider: provider };
      // 只控制应用日期，数据库事务时间保持真实值，覆盖两者跨日不一致的情况。
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2030-10-02T23:59:59.000Z'));
        const firstDay = await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request);
        expect(firstDay.createdAt).toBe('2030-10-02T23:59:59.000Z');
        await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, locale: 'en-gb' })).rejects.toMatchObject({ code: 'PRONUNCIATION_LIMIT_REACHED' });
        vi.setSystemTime(new Date('2030-10-03T00:00:00.000Z'));
        const secondDay = await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, locale: 'en-gb' });
        expect(secondDay.createdAt).toBe('2030-10-03T00:00:00.000Z');
        expect((await createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), request)).id).toBe(firstDay.id);
        await expect(createSpeakingPronunciationAssessment(deps, owner.id, crypto.randomUUID(), { ...request, materialId: null, subtitleRevision: null })).rejects.toMatchObject({ code: 'PRONUNCIATION_LIMIT_REACHED' });
        expect(provider.assess).toHaveBeenCalledTimes(2);
      } finally { vi.useRealTimers(); }
    });
  });
  it('HTTP 路由要求身份、幂等键，能力接口与查询返回共享严格契约', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = 'ab'.repeat(32);
      const user = await registerAnonymous(db, token, true);
      await db.update(users).set({ kind: 'registered' }).where(eq(users.id, user.userId));
      const [asset] = await db.insert(speakingAssets).values({ userId: user.userId, purpose: 'recording', status: 'ready', contentType: 'audio/wav',
        byteSize: audio.byteLength, duration: 2, mediaType: 'audio', storageKey: 'private/local-short', expiresAt: new Date(Date.now() + 60_000) }).returning();
      if (!asset) throw new Error('缺少测试录音');
      const provider = { assess: vi.fn(async () => result) };
      const app = buildApp({ db, config: config(), logger: false, speakingMediaStore: mediaStore(), speakingPronunciationProvider: provider });
      const body = { assetId: asset.id, materialId: null, cueId: 'local-one', referenceText: 'Stay curious.', subtitleRevision: null, locale: 'en-us' };
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() };
      try {
        expect((await app.inject({ method: 'POST', url: '/v1/speaking/pronunciation-assessments', headers: { 'content-type': 'application/json' }, payload: body })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url: '/v1/speaking/pronunciation-assessments', headers: { authorization: headers.authorization }, payload: body })).statusCode).toBe(400);
        const response = await app.inject({ method: 'POST', url: '/v1/speaking/pronunciation-assessments', headers, payload: body });
        expect(response.statusCode).toBe(200);
        const ready = SpeakingPronunciationAssessmentDtoSchema.parse(response.json());
        const fetched = await app.inject({ method: 'GET', url: `/v1/speaking/pronunciation-assessments/${ready.id}`, headers: { authorization: headers.authorization } });
        expect(fetched.statusCode).toBe(200); expect(fetched.json()).toEqual(ready);
        const capability = await app.inject({ method: 'GET', url: '/v1/speaking/capabilities', headers: { authorization: headers.authorization } });
        expect(capability.json().pronunciation.available).toBe(true);
        const recordCount = await db.select().from(speakingPronunciationAssessments).where(and(eq(speakingPronunciationAssessments.userId, user.userId), eq(speakingPronunciationAssessments.status, 'ready')));
        expect(recordCount).toHaveLength(1);
        expect(provider.assess).toHaveBeenCalledTimes(1);
      } finally { await app.close(); }
    });
  });
});

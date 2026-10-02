import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES, SpeakingCapabilitiesDtoSchema,
  SpeakingMaterialDtoSchema, SpeakingPronunciationAssessmentDtoSchema,
  type CreateSpeakingPronunciationRequest, type SpeakingPronunciationResult,
} from '@context-reader/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../server/src/core/errors';
import type { PronunciationProvider } from '../../../../server/src/infrastructure/speech/provider';
import { getEvolinkAudioSettings, type ApiEnv, type D1DatabaseBinding, type D1StatementBinding } from '../env';
import { handleSpeakingAssetRoute } from './assets';
import { handleSpeakingRoute } from './routes';
import { pronunciationRequestFingerprint } from '../../../../server/src/modules/speaking/pronunciation-shared';

const catalog = vi.hoisted(() => ({ get: vi.fn(), detail: vi.fn() }));
vi.mock('./catalog', () => ({ getPlatformCatalog: catalog.get, getPlatformMaterial: catalog.detail }));

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const guest = '33333333-3333-4333-8333-333333333333';
const databases: DatabaseSync[] = [];
const result: SpeakingPronunciationResult = { kind: 'ai_coaching', score: 86, words: [],
  transcript: 'Stay curious.', clarityScore: 86, fluencyScore: 82, completenessScore: 100,
  wordTips: [{ word: 'curious', advice: '先慢读，再放回整句练习。' }],
  feedback: ['听示范后再连贯读一次。'] };

// SQLite 使用和生产 D1 相同的迁移与事务，禁止事务内 await 引入假并发。
class TestStatement implements D1StatementBinding {
  constructor(readonly binding: TestDatabase, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]) {
    if (values.length > 100) throw new Error('D1 bound parameter limit exceeded');
    return new TestStatement(this.binding, this.sql, values as SQLInputValue[]);
  }
  async first<T>(): Promise<T | null> {
    return (this.binding.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.binding.database.prepare(this.sql).all(...this.values) as T[] };
  }
  execute() { return this.binding.database.prepare(this.sql).run(...this.values); }
  async run() { return this.execute(); }
}
class TestDatabase implements D1DatabaseBinding {
  beforeNextBatch: (() => void) | undefined;
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) { return new TestStatement(this, sql); }
  async batch(statements: D1StatementBinding[]): Promise<unknown[]> {
    const hook = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    hook?.();
    this.database.exec('BEGIN');
    try {
      const values = statements.map(statement => (statement as TestStatement).execute());
      this.database.exec('COMMIT');
      return values;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}

beforeEach(() => {
  const material = SpeakingMaterialDtoSchema.parse({ id: 'platform-one', title: '测试口语', subtitle: '练习', category: '测试',
    sourceKind: 'platform', mediaType: 'audio', assetId: null, videoId: null, duration: 60,
    cues: [{ id: 'cue-one', start: 0, end: 3, en: 'Stay curious.', zh: '保持好奇。' }],
    revision: 1, createdAt: '2026-01-01T00:00:00.000Z' });
  catalog.get.mockResolvedValue({ materials: [{ ...material, cueCount: 1 }] });
  catalog.detail.mockResolvedValue(material);
});
afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
  vi.restoreAllMocks();
});

function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  const migrations = resolve('cloudflare/api/migrations');
  for (const name of readdirSync(migrations).filter(value => value.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(migrations, name), 'utf8'));
  }
  for (const id of [owner, other, guest]) {
    database.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
      .run(id, id === guest ? 'guest' : 'registered', new Date().toISOString());
  }
  const db = new TestDatabase(database);
  const objects = new Map<string, { bytes: Uint8Array; size: number; type: string; etag: string }>();
  const get = vi.fn(async (key: string) => {
    const object = objects.get(key);
    return object ? { size: object.size, etag: object.etag, httpEtag: `"${object.etag}"`,
      httpMetadata: { contentType: object.type }, body: new Response(new Uint8Array(object.bytes)).body! } : null;
  });
  const env = { DB: db, EVOLINK_API_KEY: 'fake-secret-never-return',
    SPEAKING_BUCKET: { get, head: vi.fn(), delete: vi.fn() }, R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'test-bucket' } as unknown as ApiEnv;
  const assess = vi.fn<PronunciationProvider['assess']>().mockResolvedValue(result);
  function seed(options: { userId?: string; purpose?: string; duration?: number; size?: number; type?: string;
    status?: string; expiresAt?: string; storageKey?: string } = {}) {
    const id = crypto.randomUUID();
    const userId = options.userId ?? owner;
    const size = options.size ?? 64;
    const type = options.type ?? 'audio/wav';
    const key = options.storageKey ?? `users/${userId}/${id}/source`;
    database.prepare(`INSERT INTO speaking_assets
      (id,user_id,status,content_type,byte_size,purpose,storage_key,duration,media_type,etag,expires_at)
      VALUES (?,?,?,?,?,?,?,?,'audio','test-etag',?)`)
      .run(id, userId, options.status ?? 'ready', type, size, options.purpose ?? 'recording', key, options.duration ?? 3,
        options.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString());
    objects.set(key, { bytes: new Uint8Array(Math.min(size, 128)), size, type, etag: 'test-etag' });
    return id;
  }
  return { database, db, env, objects, get, assess, provider: { assess }, seed };
}

function payload(assetId: string, updates: Partial<CreateSpeakingPronunciationRequest> = {}): CreateSpeakingPronunciationRequest {
  return { assetId, materialId: null, cueId: 'cue-one', referenceText: 'Stay curious.', subtitleRevision: null,
    locale: 'en-us', ...updates };
}
function request(path: string, method = 'GET', body?: unknown, key: string | null = crypto.randomUUID()) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set('idempotency-key', key);
  return new Request(`https://blackholeenglish.com/v1/speaking/${path}`, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function create(env: ApiEnv, body: unknown, provider?: PronunciationProvider,
  key: string | null = crypto.randomUUID(), userId = owner) {
  const response = await handleSpeakingRoute(request('pronunciation-assessments', 'POST', body, key), env, userId, provider);
  expect(response?.headers.get('cache-control')).toBe('no-store');
  const assessment = SpeakingPronunciationAssessmentDtoSchema.parse(await response!.json());
  expect(response?.status).toBe(assessment.status === 'processing' ? 202 : 200);
  return assessment;
}
async function getAssessment(env: ApiEnv, id: string, userId = owner) {
  const response = await handleSpeakingRoute(request(`pronunciation-assessments/${id}`), env, userId);
  expect(response?.headers.get('cache-control')).toBe('no-store');
  return SpeakingPronunciationAssessmentDtoSchema.parse(await response!.json());
}
function count(database: DatabaseSync, table = 'speaking_pronunciation_assessments') {
  return database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()!.total;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('D1 发音评分路由', () => {
  it('保留旧专用评测来源，新点评不复用旧评分；换模型后新键重评，同键继续回放', async () => {
    const { database, env, seed, provider, assess } = setup();
    const body = payload(seed());
    const legacyId = crypto.randomUUID();
    const legacyResult = { score: 91, words: [{ word: 'Stay', score: 91, startMs: null, endMs: null, phonemes: [] }], feedback: [] };
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO speaking_pronunciation_assessments
      (id,user_id,asset_id,cue_id,reference_text,locale,fingerprint,status,result_json,created_at,updated_at,deadline_at)
      VALUES (?,?,?,?,?,?,?,'ready',?,?,?,?)`)
      .run(legacyId, owner, body.assetId, body.cueId, body.referenceText, body.locale,
        await pronunciationRequestFingerprint(body), JSON.stringify(legacyResult), now, now, now);
    expect(await getAssessment(env, legacyId)).toMatchObject({ provider: 'speechace', result: legacyResult });
    const key = crypto.randomUUID();
    const first = await create(env, body, provider, key);
    expect(first).toMatchObject({ provider: 'evolink', result: { kind: 'ai_coaching', words: [] } });
    expect(first.id).not.toBe(legacyId);
    env.EVOLINK_AUDIO_MODEL = 'gemini-2.5-flash-lite';
    expect((await create(env, body, provider, key)).id).toBe(first.id);
    expect((await create(env, body, provider)).id).not.toBe(first.id);
    expect(assess).toHaveBeenCalledTimes(2);
  });
  it('从私有录音读取评分并保存快照，删旧录音后同键仍回放历史结果', async () => {
    const { database, env, seed, provider, assess } = setup();
    const assetId = seed();
    const key = crypto.randomUUID();
    const body = payload(assetId);
    const assessment = await create(env, body, provider, key);
    expect(assessment).toMatchObject({ assetId, status: 'ready', result, referenceText: 'Stay curious.', locale: 'en-us' });
    expect(assess).toHaveBeenCalledWith({ audio: new Uint8Array(64), contentType: 'audio/wav',
      referenceText: 'Stay curious.', locale: 'en-us' });
    database.prepare('DELETE FROM speaking_assets WHERE id = ?').run(assetId);
    delete env.EVOLINK_API_KEY;
    expect((await create(env, body, undefined, key)).id).toBe(assessment.id);
    expect((await create(env, body)).id).toBe(assessment.id);
    expect((await getAssessment(env, assessment.id)).result).toEqual(result);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(assessment)).not.toMatch(/test-etag|users\/|fingerprint|deadline_at|fake-secret/u);
  });

  it('同指纹不同键并发只调用一次上游，新键指向真实处理中记录', async () => {
    const { database, env, seed, provider, assess } = setup();
    const started = deferred<void>();
    const finished = deferred<SpeakingPronunciationResult>();
    assess.mockImplementationOnce(async () => { started.resolve(); return finished.promise; });
    const body = payload(seed());
    const first = create(env, body, provider);
    await started.promise;
    const concurrent = await create(env, body, provider);
    expect(concurrent.status).toBe('processing');
    expect(assess).toHaveBeenCalledTimes(1);
    finished.resolve(result);
    const completed = await first;
    expect(completed.id).toBe(concurrent.id);
    const replay = await create(env, body, provider);
    expect(replay).toEqual(completed);
    expect(database.prepare('SELECT DISTINCT resource_id FROM speaking_idempotency').all()).toEqual([{ resource_id: completed.id }]);
    expect(count(database)).toBe(1);
    expect(count(database, 'speaking_idempotency')).toBe(3);
    expect(count(database, 'transaction_guards')).toBe(0);
  });

  it('同键并发重放且拒绝口音或字幕变化后的重复键', async () => {
    const { database, env, seed, provider, assess } = setup();
    const body = payload(seed());
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([create(env, body, provider, key), create(env, body, provider, key)]);
    expect(a.id).toBe(b.id);
    await expect(create(env, { ...body, locale: 'en-gb' }, provider, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(create(env, { ...body, referenceText: 'Keep practicing.' }, provider, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(count(database)).toBe(1);
    expect(assess).toHaveBeenCalledTimes(1);
    const conflictKey = crypto.randomUUID();
    const outcomes = await Promise.allSettled([
      create(env, payload(seed()), provider, conflictKey), create(env, payload(seed()), provider, conflictKey),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(count(database)).toBe(2);
  });

  it('失败保留录音并脱敏，旧键不自动调用，新键允许明确重试', async () => {
    const { database, env, seed, provider, assess } = setup();
    const body = payload(seed());
    const key = crypto.randomUUID();
    assess.mockRejectedValueOnce(new Error('https://api.speechace.co?key=fake-secret-never-return secret upstream body'));
    const failed = await create(env, body, provider, key);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'PRONUNCIATION_UPSTREAM_UNAVAILABLE', retryable: true } });
    expect(JSON.stringify(failed)).not.toMatch(/speechace\.co|fake-secret|upstream body/u);
    expect(await create(env, body, provider, key)).toEqual(failed);
    expect(assess).toHaveBeenCalledTimes(1);
    const retried = await create(env, body, provider);
    expect(retried.status).toBe('ready');
    expect(retried.id).not.toBe(failed.id);
    expect(count(database)).toBe(2);
    expect(count(database, 'speaking_assets')).toBe(1);
  });

  it('静音和无效结果进入稳定失败，不把空词或缺失分数当作评分', async () => {
    const { env, seed, provider, assess } = setup();
    assess.mockRejectedValueOnce(new AppError('PRONUNCIATION_NO_SPEECH', '未检测到清晰语音，请重新录制', 422));
    expect(await create(env, payload(seed()), provider)).toMatchObject({ status: 'failed', result: null,
      error: { code: 'PRONUNCIATION_NO_SPEECH', retryable: false } });
    assess.mockResolvedValueOnce({ ...result, feedback: [] });
    expect(await create(env, payload(seed()), provider)).toMatchObject({ status: 'failed', result: null,
      error: { code: 'PRONUNCIATION_INVALID_RESULT', retryable: true } });
  });

  it('过期处理中记录释放指纹，迟到上游不能覆盖失败或重试结果', async () => {
    const { database, env, seed, provider, assess } = setup();
    const started = deferred<void>();
    const finished = deferred<SpeakingPronunciationResult>();
    assess.mockImplementationOnce(async () => { started.resolve(); return finished.promise; });
    const body = payload(seed());
    const key = crypto.randomUUID();
    const pending = create(env, body, provider, key);
    await started.promise;
    const id = database.prepare('SELECT id FROM speaking_pronunciation_assessments').get()!.id as string;
    database.prepare('UPDATE speaking_pronunciation_assessments SET deadline_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);
    const expired = await getAssessment(env, id);
    expect(expired).toMatchObject({ status: 'failed', error: { retryable: true } });
    expect((await create(env, body, provider, key)).id).toBe(id);
    expect(assess).toHaveBeenCalledTimes(1);
    const retry = await create(env, body, provider);
    expect(retry).toMatchObject({ status: 'ready', result });
    expect(retry.id).not.toBe(id);
    finished.resolve({ ...result, score: 12 });
    expect((await pending).status).toBe('failed');
    expect((await getAssessment(env, retry.id)).result?.score).toBe(86);
    expect(count(database)).toBe(2);
  });

  it('R2 读取期间评分已失效并重试，旧请求读取完成后不调用上游', async () => {
    const { database, env, seed, provider, get, assess } = setup();
    const entered = deferred<void>();
    const release = deferred<void>();
    const originalGet = get.getMockImplementation()!;
    get.mockImplementationOnce(async key => {
      const object = await originalGet(key);
      entered.resolve();
      await release.promise;
      return object;
    });
    const body = payload(seed());
    const pending = create(env, body, provider);
    await entered.promise;
    const id = database.prepare('SELECT id FROM speaking_pronunciation_assessments').get()!.id as string;
    database.prepare('UPDATE speaking_pronunciation_assessments SET deadline_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', id);
    expect((await getAssessment(env, id)).status).toBe('failed');
    const retry = await create(env, body, provider);
    expect(retry.status).toBe('ready');
    expect(assess).toHaveBeenCalledTimes(1);
    release.resolve();
    expect((await pending).status).toBe('failed');
    expect(assess).toHaveBeenCalledTimes(1);
    expect(retry.id).not.toBe(id);
  });

  it('R2 get 超过整体十秒限制则安全失败，迟到响应会被取消且不调用评分', async () => {
    vi.useFakeTimers();
    const { env, seed, provider, get, assess } = setup();
    const entered = deferred<void>();
    const late = deferred<Awaited<ReturnType<typeof get>>>();
    const cancelled = vi.fn();
    get.mockImplementationOnce(async () => { entered.resolve(); return late.promise; });
    const pending = create(env, payload(seed()), provider);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    const failed = await pending;
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'MEDIA_UNAVAILABLE', retryable: true } });
    expect(JSON.stringify(failed)).not.toContain('users/');
    expect(assess).not.toHaveBeenCalled();
    late.resolve({ size: 64, etag: 'test-etag', httpEtag: '"test-etag"',
      httpMetadata: { contentType: 'audio/wav' }, body: new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel: cancelled }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(assess).not.toHaveBeenCalled();
  });

  it('R2 get 与内容流共用十秒限制，读取超时会取消并释放 reader', async () => {
    vi.useFakeTimers();
    const { env, seed, provider, get, assess } = setup();
    const entered = deferred<void>();
    const reading = deferred<void>();
    const late = deferred<Awaited<ReturnType<typeof get>>>();
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull() { reading.resolve(); return new Promise<void>(() => undefined); }, cancel: cancelled,
    }, { highWaterMark: 0 });
    get.mockImplementationOnce(async () => { entered.resolve(); return late.promise; });
    const pending = create(env, payload(seed()), provider);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(8_000);
    late.resolve({ size: 64, etag: 'test-etag', httpEtag: '"test-etag"', httpMetadata: { contentType: 'audio/wav' }, body: stream });
    await reading.promise;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toMatchObject({ status: 'failed', error: { code: 'MEDIA_UNAVAILABLE', retryable: true } });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(assess).not.toHaveBeenCalled();
  });

  it('日限额原子限制新尝试，缓存和幂等回放不计数，账号与 UTC 日独立', async () => {
    const { database, env, seed, provider, assess } = setup();
    env.SPEAKING_COACH_DAILY_LIMIT = '1';
    const body = payload(seed());
    const first = await create(env, body, provider);
    expect((await create(env, body, provider)).id).toBe(first.id);
    await expect(create(env, payload(seed()), provider)).rejects.toMatchObject({ code: 'PRONUNCIATION_LIMIT_REACHED', statusCode: 429 });
    expect(count(database, 'speaking_idempotency')).toBe(2);
    expect(assess).toHaveBeenCalledTimes(1);
    expect((await create(env, payload(seed({ userId: other })), provider, crypto.randomUUID(), other)).status).toBe('ready');
    database.prepare('UPDATE speaking_pronunciation_assessments SET created_at = ? WHERE user_id = ?')
      .run(new Date(Date.now() - 86_400_000).toISOString(), owner);
    expect((await create(env, payload(seed()), provider)).status).toBe('ready');
    expect(count(database)).toBe(3);
    const next = setup();
    next.env.SPEAKING_COACH_DAILY_LIMIT = '1';
    const attempts = await Promise.allSettled([
      create(next.env, payload(next.seed()), next.provider), create(next.env, payload(next.seed()), next.provider),
    ]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'PRONUNCIATION_LIMIT_REACHED' } });
    expect(count(next.database)).toBe(1);
    expect(count(next.database, 'speaking_idempotency')).toBe(1);
    expect(next.assess).toHaveBeenCalledTimes(1);
  });

  it('校验登录账号与归属，其他账号不能读取评分或提交该录音', async () => {
    const { database, env, seed, provider, assess } = setup();
    const body = payload(seed());
    const scored = await create(env, body, provider);
    await expect(getAssessment(env, scored.id, other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(create(env, body, provider, crypto.randomUUID(), other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(create(env, payload(seed({ userId: guest })), provider, crypto.randomUUID(), guest))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    await expect(getAssessment(env, scored.id, guest)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(count(database)).toBe(1);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it('云端字幕须匹配原文、编号和版本，个人修改也使用有效版本', async () => {
    const { database, env, seed, provider } = setup();
    const body = payload(seed(), { materialId: 'platform-one', subtitleRevision: 1 });
    for (const changed of [{ cueId: 'unknown-cue' }, { referenceText: 'Different words.' }, { subtitleRevision: 2 }]) {
      await expect(create(env, { ...body, ...changed }, provider)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    }
    database.prepare(`INSERT INTO speaking_states (user_id,material_id,subtitle_revision,custom_cues_json)
      VALUES (?, 'platform-one', 2, ?)`)
      .run(owner, JSON.stringify([{ id: 'cue-one', start: 0, end: 3, en: 'Keep practicing.', zh: '继续练习。' }]));
    await expect(create(env, body, provider)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect((await create(env, { ...body, referenceText: 'Keep practicing.', subtitleRevision: 2 }, provider)).status).toBe('ready');
  });

  it('字幕或资产在预读后变化时回滚占有，避免使用旧快照收费', async () => {
    for (const change of ['revision', 'expires', 'delete'] as const) {
      const { database, db, env, seed, provider, assess } = setup();
      const assetId = seed();
      const body = payload(assetId, { materialId: 'platform-one', subtitleRevision: 1 });
      db.beforeNextBatch = () => {
        if (change === 'revision') database.prepare('INSERT INTO speaking_states (user_id,material_id,subtitle_revision) VALUES (?, ?, 2)').run(owner, 'platform-one');
        else if (change === 'delete') database.prepare('DELETE FROM speaking_assets WHERE id = ?').run(assetId);
        else database.prepare('UPDATE speaking_assets SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', assetId);
      };
      await expect(create(env, body, provider)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(assess).not.toHaveBeenCalled();
      expect(count(database)).toBe(0);
      expect(count(database, 'speaking_idempotency')).toBe(0);
    }
  });

  it('拒绝未就绪、非录音、过长、过大和错误格式资产', async () => {
    const { env, seed, provider, assess } = setup();
    for (const options of [{ status: 'awaiting_upload' }, { purpose: 'material' }, { duration: 31 },
      { size: SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES + 1 }, { type: 'video/mp4' }, { duration: 0 }]) {
      await expect(create(env, payload(seed(options)), provider)).rejects.toMatchObject({ code: 'PRONUNCIATION_AUDIO_INVALID' });
    }
    await expect(create(env, payload(seed({ expiresAt: '2000-01-01T00:00:00.000Z' })), provider))
      .rejects.toMatchObject({ code: 'UPLOAD_SESSION_EXPIRED' });
    expect(assess).not.toHaveBeenCalled();
  });

  it('校验真实 R2 大小、内容流、ETag和媒体类型，无法读到完整录音时不调用上游', async () => {
    for (const changed of [null, { size: 63 }, { etag: 'different' }, { type: 'video/mp4' },
      { bytes: new Uint8Array(65) }, { bytes: new Uint8Array(63) }] as const) {
      const { env, objects, seed, provider, assess } = setup();
      const assetId = seed();
      const key = `users/${owner}/${assetId}/source`;
      if (changed === null) objects.delete(key);
      else objects.set(key, { ...objects.get(key)!, ...changed });
      const assessment = await create(env, payload(assetId), provider);
      expect(assessment).toMatchObject({ status: 'failed', result: null });
      expect(assess).not.toHaveBeenCalled();
    }
    const { env, seed, provider, assess } = setup();
    const assessment = await create(env, payload(seed({ storageKey: 'someone-else/source' })), provider);
    expect(assessment.error?.code).toBe('PRONUNCIATION_AUDIO_INVALID');
    expect(assess).not.toHaveBeenCalled();
  });

  it('严格请求拒绝多余字段、无英文、未知口音和缺少幂等键', async () => {
    const { database, env, seed, provider } = setup();
    const body = payload(seed());
    for (const invalid of [{ ...body, audioUrl: 'https://private.example/audio' }, { ...body, referenceText: '只有中文' },
      { ...body, referenceText: 'a'.repeat(1001) }, { ...body, locale: 'fr-fr' },
      { ...body, materialId: 'platform-one', subtitleRevision: null }]) {
      await expect(create(env, invalid, provider)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await expect(create(env, body, provider, null)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(count(database)).toBe(0);
  });

  it('能力明确提示未配置且新请求不占有次数，环境错误只报告变量名', async () => {
    const { database, env, seed } = setup();
    delete env.EVOLINK_API_KEY;
    const response = await handleSpeakingAssetRoute(request('capabilities'), env, owner);
    expect(SpeakingCapabilitiesDtoSchema.parse(await response!.json()).pronunciation).toEqual({ available: false,
      provider: 'evolink', maxDurationMs: 30_000, maxAudioBytes: SPEAKING_PRONUNCIATION_MAX_AUDIO_BYTES,
      locales: ['en-us', 'en-gb'] });
    await expect(create(env, payload(seed()))).rejects.toMatchObject({ code: 'PRONUNCIATION_NOT_CONFIGURED' });
    expect(count(database)).toBe(0);
    expect(getEvolinkAudioSettings(env)).toMatchObject({ apiKey: undefined, model: 'gemini-2.5-flash', timeoutMs: 20_000, dailyLimit: 50 });
    for (const [name, value] of [['EVOLINK_AUDIO_MODEL', 'https://evil.example/?secret=hidden'],
      ['EVOLINK_AUDIO_TIMEOUT_MS', '40000'], ['SPEAKING_COACH_DAILY_LIMIT', '-1']] as const) {
      const invalid = { ...env, [name]: value };
      expect(() => getEvolinkAudioSettings(invalid)).toThrow(name);
      try { getEvolinkAudioSettings(invalid); }
      catch (error) { expect(String(error)).not.toContain(value); }
    }
  });
});

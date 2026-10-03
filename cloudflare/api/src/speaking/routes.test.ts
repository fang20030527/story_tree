import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  SpeakingCatalogDtoSchema, SpeakingLibraryDtoSchema, SpeakingMaterialDtoSchema, SpeakingMaterialListSchema,
  SpeakingSessionDtoSchema, SpeakingStateDtoSchema,
  type SpeakingCue, type SpeakingMaterialDto,
} from '@context-reader/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import { handleSpeakingRoute } from './routes';

const catalog = vi.hoisted(() => ({ get: vi.fn(), detail: vi.fn() }));
vi.mock('./catalog', () => ({ getPlatformCatalog: catalog.get, getPlatformMaterial: catalog.detail }));

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const cues: SpeakingCue[] = [
  { id: 'cue-one', start: 1, end: 4, en: 'Stay curious.', zh: '保持好奇。' },
  { id: 'cue-two', start: 3, end: 6, en: 'Keep practicing.', zh: '继续练习。' },
];
const databases: DatabaseSync[] = [];

// 用本地 SQLite 复现 D1 的参数上限与 batch 事务，测试不连接生产资源。
class TestStatement implements D1StatementBinding {
  constructor(readonly binding: TestDatabase, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  get database() { return this.binding.database; }
  bind(...values: unknown[]): TestStatement {
    if (values.length > 100) throw new Error('D1 bound parameter limit exceeded');
    return new TestStatement(this.binding, this.sql, values as SQLInputValue[]);
  }
  async first<T>(): Promise<T | null> {
    const result = (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
    const hook = this.binding.afterNextFirst;
    this.binding.afterNextFirst = undefined;
    await hook?.();
    return result;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }
  async run(): Promise<unknown> { return this.execute(); }
  execute(): unknown { return this.database.prepare(this.sql).run(...this.values); }
}

class TestDatabase implements D1DatabaseBinding {
  beforeNextBatch: (() => void) | undefined;
  afterNextFirst: (() => Promise<void>) | undefined;
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string): TestStatement { return new TestStatement(this, sql); }
  async batch(statements: D1StatementBinding[]): Promise<unknown[]> {
    const before = this.beforeNextBatch;
    this.beforeNextBatch = undefined;
    before?.();
    this.database.exec('BEGIN');
    try {
      // 不在事务内 await，避免测试并发请求交错执行同一个 SQLite 连接。
      const results = statements.map(statement => (statement as TestStatement).execute());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function platform(id: string): SpeakingMaterialDto {
  return SpeakingMaterialDtoSchema.parse({ id, title: '口语测试素材', subtitle: '每日练习', category: '测试',
    sourceKind: 'platform', mediaType: 'audio', assetId: null, videoId: null,
    duration: 60, cues, revision: 1, createdAt: '2026-01-01T00:00:00.000Z' });
}
function setCatalog(count = 3, revision = 1, contents = cues) {
  const materials = Array.from({ length: count }, (_, index) => ({ ...platform(`platform-${index}`), revision, cues: contents }));
  catalog.get.mockResolvedValue(SpeakingCatalogDtoSchema.parse({ materials: materials.map(material => {
    const { cues: contents, ...summary } = material;
    return { ...summary, cueCount: contents.length };
  }) }));
  catalog.detail.mockImplementation(async (_env: ApiEnv, id: string) => materials.find(material => material.id === id));
}
beforeEach(() => setCatalog());
afterEach(() => { for (const database of databases.splice(0)) database.close(); vi.restoreAllMocks(); });

function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys = ON');
  const directory = resolve('cloudflare/api/migrations');
  for (const filename of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(resolve(directory, filename), 'utf8'));
  }
  for (const id of [owner, other]) database.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .run(id, 'registered', new Date().toISOString());
  const db = new TestDatabase(database);
  return { database, db, env: { DB: db } as unknown as ApiEnv };
}
function request(path: string, method = 'GET', payload?: unknown, key: string | null = crypto.randomUUID()) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set('idempotency-key', key);
  return new Request(`https://blackholeenglish.com/v1/speaking/${path}`, { method, headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
async function call(env: ApiEnv, path: string, method = 'GET', payload?: unknown,
  key: string | null = crypto.randomUUID(), userId = owner) {
  const response = await handleSpeakingRoute(request(path, method, payload, key), env, userId);
  if (!response) throw new Error('Test route was not handled');
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response;
}
async function create(env: ApiEnv, key = crypto.randomUUID(), userId = owner, title = '测试视频') {
  const response = await call(env, 'materials', 'POST', {
    sourceKind: 'youtube', videoId: 'M7lc1UVf-VE', title, duration: 60, cues,
  }, key, userId);
  expect(response.status).toBe(201);
  return SpeakingMaterialDtoSchema.parse(await response.json());
}
async function state(env: ApiEnv, materialId: string, userId = owner) {
  return SpeakingStateDtoSchema.parse(await (await call(env, `materials/${materialId}/state`, 'GET', undefined, null, userId)).json());
}
function seedAsset(database: DatabaseSync, options: { userId?: string; purpose?: 'material' | 'recording'; duration?: number } = {}) {
  const id = crypto.randomUUID();
  const userId = options.userId ?? owner;
  database.prepare(`INSERT INTO speaking_assets
    (id, user_id, status, content_type, byte_size, purpose, storage_key, duration, media_type, etag, expires_at)
    VALUES (?, ?, 'ready', 'audio/wav', 32044, ?, ?, ?, 'audio', 'synthetic-etag', ?)`)
    .run(id, userId, options.purpose ?? 'material', `users/${userId}/${id}/source`, options.duration ?? 60,
      new Date(Date.now() + 86_400_000).toISOString());
  return id;
}
function count(database: DatabaseSync, table: 'speaking_materials' | 'speaking_states' | 'speaking_sessions' | 'speaking_idempotency' | 'transaction_guards') {
  return database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()!.total;
}

describe('生产 D1 口语数据路由', () => {
  it('使用同一个账号绑定真实资产元数据，幂等回放且隔离其他账号', async () => {
    const { database, env } = setup();
    const assetId = seedAsset(database);
    const payload = { sourceKind: 'file', assetId, title: '带字幕音频', cues };
    const key = crypto.randomUUID();
    const material = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials', 'POST', payload, key)).json());
    expect(material).toMatchObject({ sourceKind: 'file', assetId, duration: 60, mediaType: 'audio', revision: 1, cues });
    const replay = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials', 'POST', payload, key)).json());
    expect(replay.id).toBe(material.id);
    expect(count(database, 'speaking_materials')).toBe(1);
    await expect(call(env, 'materials', 'POST', { ...payload, title: '不同标题' }, key))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', statusCode: 409 });
    await expect(call(env, 'materials', 'POST', payload)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    for (const path of [`materials/${material.id}`, `materials/${material.id}/state`]) {
      await expect(call(env, path, 'GET', undefined, null, other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(call(env, 'materials', 'POST', payload, crypto.randomUUID(), other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const library = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library')).json());
    expect(library.materials.find(item => item.id === material.id)).toMatchObject({ cueCount: 2 });
    expect(JSON.stringify(library)).not.toMatch(/storage_key|synthetic-etag|users\//u);
    expect(library.materials.every(item => !('cues' in item))).toBe(true);
  });

  it('两个请求竞争绑定同一资产时只提交一个完整素材', async () => {
    const { database, env } = setup();
    const assetId = seedAsset(database);
    const payload = { sourceKind: 'file', assetId, title: '并发绑定', cues };
    const outcomes = await Promise.allSettled([
      call(env, 'materials', 'POST', payload), call(env, 'materials', 'POST', payload),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'STATE_CONFLICT' }) }),
    ]);
    expect(count(database, 'speaking_materials')).toBe(1);
    expect(count(database, 'speaking_idempotency')).toBe(1);
    expect(count(database, 'transaction_guards')).toBe(0);
  });

  it('提交前资产到期或被清理时原子回滚，禁止从预读快照绑定', async () => {
    for (const cleaned of [false, true]) {
      const { database, db, env } = setup();
      const assetId = seedAsset(database);
      db.beforeNextBatch = () => {
        if (cleaned) database.prepare('DELETE FROM speaking_assets WHERE id = ?').run(assetId);
        else database.prepare('UPDATE speaking_assets SET expires_at = ? WHERE id = ?')
          .run('2000-01-01T00:00:00.000Z', assetId);
      };
      await expect(call(env, 'materials', 'POST', { sourceKind: 'file', assetId, title: '到期素材', cues }))
        .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(count(database, 'speaking_materials')).toBe(0);
      expect(count(database, 'speaking_idempotency')).toBe(0);
      expect(count(database, 'transaction_guards')).toBe(0);
    }
  });

  it('同一个幂等键在并发提交中只创建一份素材，并拒绝不同内容', async () => {
    const { database, env } = setup();
    const key = crypto.randomUUID();
    const materials = await Promise.all([create(env, key), create(env, key)]);
    expect(materials[0]!.id).toBe(materials[1]!.id);
    expect(count(database, 'speaking_materials')).toBe(1);
    const nextKey = crypto.randomUUID();
    const outcomes = await Promise.allSettled([create(env, nextKey, owner, '第一份'), create(env, nextKey, owner, '第二份')]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }) }),
    ]);
    expect(count(database, 'speaking_materials')).toBe(2);
  });

  it('幂等预读之后同键请求先提交时，仍回放绑定及旧修订请求', async () => {
    const { database, db, env } = setup();
    const file = { sourceKind: 'file', assetId: seedAsset(database), title: '同键先提交', cues };
    const fileKey = crypto.randomUUID();
    db.afterNextFirst = async () => { await call(env, 'materials', 'POST', file, fileKey); };
    const material = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials', 'POST', file, fileKey)).json());
    expect(count(database, 'speaking_materials')).toBe(1);
    const subtitle = { revision: 1, cues: [cues[0]] };
    const subtitleKey = crypto.randomUUID();
    db.afterNextFirst = async () => { await call(env, `materials/${material.id}/subtitles`, 'PATCH', subtitle, subtitleKey); };
    expect(SpeakingMaterialDtoSchema.parse(await (await call(env, `materials/${material.id}/subtitles`, 'PATCH', subtitle, subtitleKey)).json()).revision).toBe(2);
    const patch = { revision: 1, position: 3 };
    const stateKey = crypto.randomUUID();
    db.afterNextFirst = async () => { await call(env, `materials/${material.id}/state`, 'PATCH', patch, stateKey); };
    expect(SpeakingStateDtoSchema.parse(await (await call(env, `materials/${material.id}/state`, 'PATCH', patch, stateKey)).json()).revision).toBe(2);
    expect(count(database, 'speaking_idempotency')).toBe(3);
  });

  it('导入与校正字幕保留相同句子的笔记，移除失效句子并推进状态修订', async () => {
    const { env } = setup();
    const material = await create(env);
    const initialState = await state(env, material.id);
    await call(env, `materials/${material.id}/state`, 'PATCH', {
      revision: initialState.revision, savedCueIds: ['cue-one', 'cue-two'], notes: { 'cue-one': '保留', 'cue-two': '移除' },
    });
    const changedCues = [{ ...cues[0]!, en: 'Stay curious every day.' }];
    const editKey = crypto.randomUUID();
    const patch = { revision: material.revision, cues: changedCues };
    const corrected = SpeakingMaterialDtoSchema.parse(await (await call(env, `materials/${material.id}/subtitles`, 'PATCH', patch, editKey)).json());
    expect(corrected).toMatchObject({ revision: 2, cues: changedCues });
    expect(await state(env, material.id)).toMatchObject({ revision: 2, savedCueIds: ['cue-one'], notes: { 'cue-one': '保留' } });
    await call(env, `materials/${material.id}/subtitles`, 'PATCH', patch, editKey);
    expect((await state(env, material.id)).revision).toBe(2);
    await expect(call(env, `materials/${material.id}/state`, 'PATCH', { revision: 1, position: 2 }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const imported = SpeakingMaterialDtoSchema.parse(await (await call(env, `materials/${material.id}/subtitles/import`, 'POST', {
      revision: corrected.revision, format: 'srt', text: '1\n00:00:01,000 --> 00:00:04,000\nStay curious.\n保持好奇。\n\n2\n00:00:03,000 --> 00:00:06,000\nKeep practicing.',
    })).json());
    expect(imported.cues).toHaveLength(2);
    expect(imported.cues[0]).toMatchObject({ en: 'Stay curious.', zh: '保持好奇。' });
    expect(imported.cues[1]!.start).toBeLessThan(imported.cues[0]!.end);
    expect(await state(env, material.id)).toMatchObject({ revision: 3, notes: {}, savedCueIds: [] });
    const restored = SpeakingMaterialDtoSchema.parse(await (await call(env, `materials/${material.id}/subtitles/import`, 'POST', {
      revision: imported.revision, format: 'vtt', text: 'WEBVTT\n\n00:01.000 --> 00:04.000\nStay curious.\n\n00:03.000 --> 00:06.000\nKeep practicing.',
    })).json());
    expect(restored.cues.map(cue => cue.id)).toEqual(imported.cues.map(cue => cue.id));
  });

  it('字幕和学习状态的竞争写入以修订号整批回滚', async () => {
    const { database, env } = setup();
    const material = await create(env);
    const edits = await Promise.allSettled(['left', 'right'].map(en => call(env, `materials/${material.id}/subtitles`, 'PATCH', {
      revision: 1, cues: [{ ...cues[0]!, en }],
    })));
    expect(edits.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(edits.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'STATE_CONFLICT' }) }),
    ]);
    const current = await state(env, material.id);
    const updates = await Promise.allSettled([10, 20].map(position => call(env, `materials/${material.id}/state`, 'PATCH', {
      revision: current.revision, position,
    })));
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await state(env, material.id)).revision).toBe(current.revision + 1);
    expect(count(database, 'speaking_idempotency')).toBe(3);
    expect(count(database, 'transaction_guards')).toBe(0);
  });

  it('平台字幕校正、收藏和笔记按账号独立保存', async () => {
    const { database, env } = setup();
    const payload = { revision: 1, cues: [{ ...cues[0]!, en: 'Personal subtitle.' }] };
    const corrected = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials/platform-0/subtitles', 'PATCH', payload)).json());
    expect(corrected.revision).toBe(2);
    const original = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials/platform-0', 'GET', undefined, null, other)).json());
    expect(original).toMatchObject({ revision: 1, cues });
    await call(env, 'materials/platform-0/state', 'PATCH', { revision: 1, savedCueIds: ['cue-one'], notes: { 'cue-one': '个人笔记' } });
    expect(await state(env, 'platform-0', other)).toMatchObject({ revision: 0, savedCueIds: [], notes: {} });
    const library = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library')).json());
    expect(library.materials.find(item => item.id === 'platform-0')).toMatchObject({ revision: 2, cueCount: 1 });
    expect(library.states).toHaveLength(1);
    expect(count(database, 'speaking_materials')).toBe(0);
  });

  it('预译字幕升级使用发布版本，旧播放状态不遮盖新版，个人字幕仍保留', async () => {
    const { env } = setup();
    await call(env, 'materials/platform-0/state', 'PATCH', { revision: 0, position: 2 });
    const personalCues = [{ ...cues[0]!, en: 'Personal subtitle.', zh: '个人校正。' }];
    await call(env, 'materials/platform-0/subtitles', 'PATCH', { revision: 1, cues: personalCues }, crypto.randomUUID(), other);

    const bundledCues = cues.map(cue => ({ ...cue, zh: '新版预置中文。' }));
    setCatalog(3, 3, bundledCues);
    const material = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials/platform-0')).json());
    expect(material).toMatchObject({ revision: 3, cues: bundledCues });
    const library = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library')).json());
    expect(library.materials.find(item => item.id === 'platform-0')).toMatchObject({ revision: 3, cueCount: 2 });
    await call(env, 'materials/platform-0/state', 'PATCH', { revision: 1, position: 4 });
    expect(await state(env, 'platform-0')).toMatchObject({ revision: 2, position: 4 });

    await expect(call(env, 'materials/platform-0/subtitles', 'PATCH', { revision: 1, cues })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const corrected = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials/platform-0/subtitles', 'PATCH', { revision: 3, cues: bundledCues })).json());
    expect(corrected.revision).toBe(4);
    const personal = SpeakingMaterialDtoSchema.parse(await (await call(env, 'materials/platform-0', 'GET', undefined, null, other)).json());
    expect(personal).toMatchObject({ revision: 2, cues: personalCues });
    const personalLibrary = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library', 'GET', undefined, null, other)).json());
    expect(personalLibrary.materials.find(item => item.id === 'platform-0')).toMatchObject({ revision: 2, cueCount: 1 });
  });

  it('录音归属、唯一绑定、替换及字幕失效后的释放均原子提交', async () => {
    const { database, env } = setup();
    const first = await create(env);
    const second = await create(env);
    const foreign = seedAsset(database, { userId: other, purpose: 'recording', duration: 3 });
    const recording = { assetId: foreign, cueId: 'cue-one', durationMs: 3000 };
    await expect(call(env, `materials/${first.id}/state`, 'PATCH', { revision: 0, recording })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const assetId = seedAsset(database, { purpose: 'recording', duration: 3 });
    const ownRecording = { ...recording, assetId };
    const outcomes = await Promise.allSettled([first, second].map(material => call(env, `materials/${material.id}/state`, 'PATCH', {
      revision: 0, recording: ownRecording,
    })));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const bound = (await state(env, first.id)).recording ? first : second;
    const current = await state(env, bound.id);
    const replacement = seedAsset(database, { purpose: 'recording', duration: 2 });
    await call(env, `materials/${bound.id}/state`, 'PATCH', {
      revision: current.revision, recording: { ...ownRecording, assetId: replacement, durationMs: 2000 },
    });
    const released = database.prepare('SELECT attached_at, expires_at FROM speaking_assets WHERE id = ?').get(assetId)!;
    expect(released.attached_at).toBeNull();
    expect(String(released.expires_at) <= new Date().toISOString()).toBe(true);
    await call(env, `materials/${bound.id}/subtitles`, 'PATCH', { revision: 1, cues: [cues[1]] });
    expect((await state(env, bound.id)).recording).toBeNull();
    expect(database.prepare('SELECT attached_at FROM speaking_assets WHERE id = ?').get(replacement)!.attached_at).toBeNull();
  });

  it('累计练习时长不重复、不倒退，旧日期回报不覆盖较新的播放位置', async () => {
    const { database, env } = setup();
    const material = await create(env);
    const clientId = crypto.randomUUID();
    const earlier = new Date(Math.floor((Date.now() - 120_000) / 1000) * 1000).toISOString();
    const later = new Date(Date.now() - 60_000).toISOString();
    const first = { materialId: material.id, date: earlier, elapsedMs: 1000, cueCount: 1, position: 5 };
    const key = crypto.randomUUID();
    const firstResponse = SpeakingSessionDtoSchema.parse(await (await call(env, `sessions/${clientId}`, 'PUT', first, key)).json());
    expect(firstResponse).toMatchObject({ elapsedMs: 1000, date: earlier });
    await call(env, `sessions/${clientId}`, 'PUT', { ...first, date: earlier.replace('.000Z', 'Z') }, key);
    expect((await state(env, material.id)).revision).toBe(1);
    await call(env, `sessions/${clientId}`, 'PUT', { ...first, elapsedMs: 800, position: 2 });
    expect(await state(env, material.id)).toMatchObject({ position: 5, revision: 1 });
    await call(env, `sessions/${clientId}`, 'PUT', { ...first, elapsedMs: 2000, cueCount: 2, position: 8 });
    await call(env, `sessions/${crypto.randomUUID()}`, 'PUT', { ...first, date: later, position: 30 });
    await call(env, `sessions/${clientId}`, 'PUT', { ...first, elapsedMs: 3000, position: 12 });
    expect((await state(env, material.id)).position).toBe(30);
    await call(env, `sessions/${crypto.randomUUID()}`, 'PUT', { ...first, position: 15 });
    expect((await state(env, material.id)).position).toBe(30);
    await expect(call(env, `sessions/${clientId}`, 'PUT', { ...first, date: later })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const library = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library')).json());
    expect(library.sessions).toHaveLength(3);
    expect(library.sessions.find(session => session.id === clientId)).toMatchObject({ elapsedMs: 3000, cueCount: 2 });
    expect(count(database, 'speaking_sessions')).toBe(3);
    const otherLibrary = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library', 'GET', undefined, null, other)).json());
    expect(otherLibrary.sessions).toEqual([]);
  });

  it('摘要列表稳定分页，目录规模超过 100 时仍遵守 D1 参数限制', async () => {
    const { database, env } = setup();
    for (let index = 0; index < 3; index++) await create(env, crypto.randomUUID(), owner, `文件 ${index}`);
    const foreign = await create(env, crypto.randomUUID(), other);
    const ordered = database.prepare('SELECT id FROM speaking_materials WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(owner);
    const page = SpeakingMaterialListSchema.parse(await (await call(env, 'materials?limit=2')).json());
    expect(page.materials.filter(material => material.sourceKind !== 'platform').map(material => material.id))
      .toEqual(ordered.slice(0, 2).map(row => row.id));
    expect(page.nextCursor).toBe(ordered[1]!.id);
    const next = SpeakingMaterialListSchema.parse(await (await call(env, `materials?limit=2&cursor=${page.nextCursor}`)).json());
    expect(next.materials.filter(material => material.sourceKind !== 'platform').map(material => material.id))
      .toEqual(ordered.slice(2).map(row => row.id));
    expect(next.nextCursor).toBeNull();
    await expect(call(env, `library?cursor=${foreign.id}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    setCatalog(100);
    await call(env, 'materials/platform-99/state', 'PATCH', { revision: 0, position: 2 });
    const library = SpeakingLibraryDtoSchema.parse(await (await call(env, 'library?limit=50')).json());
    expect(library.materials).toHaveLength(103);
    expect(library.states).toEqual([expect.objectContaining({ materialId: 'platform-99', position: 2 })]);
  });

  it('拒绝无幂等键、未知字段、无效时间及超过 D1 行容量的字幕', async () => {
    const { database, env } = setup();
    const payload = { sourceKind: 'youtube', videoId: 'M7lc1UVf-VE', title: '验证', duration: 60, cues };
    await expect(call(env, 'materials', 'POST', payload, null)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(call(env, 'materials', 'POST', { ...payload, secret: 'unknown' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(call(env, 'library?unknown=1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(call(env, 'materials/%ZZ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(call(env, 'materials', 'POST', { ...payload, cues: [{ ...cues[0]!, end: 61 }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 422 });
    const hugeCues = Array.from({ length: 400 }, (_, index) => ({ id: `cue-${index}`, start: index / 10,
      end: index / 10 + 0.1, en: 'a'.repeat(4000), zh: '' }));
    await expect(call(env, 'materials', 'POST', { ...payload, cues: hugeCues }))
      .rejects.toMatchObject({ code: 'IMPORT_TOO_LARGE', statusCode: 413 });
    expect(count(database, 'speaking_materials')).toBe(0);
    expect(count(database, 'speaking_idempotency')).toBe(0);
    const material = await create(env);
    await expect(call(env, `materials/${material.id}/state`, 'PATCH', { revision: 0, notes: { missing: '不存在' } }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(call(env, `sessions/${crypto.randomUUID()}`, 'PUT', { materialId: material.id,
      date: new Date(Date.now() + 600_000).toISOString(), elapsedMs: 1000, cueCount: 1, position: 5 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await handleSpeakingRoute(new Request('https://blackholeenglish.com/v1/other'), env, owner)).toBeNull();
  });
});

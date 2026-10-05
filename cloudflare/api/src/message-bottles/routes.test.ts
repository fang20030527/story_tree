import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageBottleDtoSchema, MessageBottlePageSchema } from '@context-reader/contracts';
import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import { handleMessageBottleRoute } from './routes';
import worker from '../index';
import { hashInstallationToken } from '../auth/token';

// Node 本地验证 Worker 分发，Durable Object 导出由 Cloudflare 运行时提供。
vi.mock('../cpu/object', () => ({ CpuBoundary: class {} }));

class Statement implements D1StatementBinding {
  constructor(readonly db: Database, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.db, this.sql, values as SQLInputValue[]); }
  async first<T>(): Promise<T | null> { return (this.db.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: this.db.sqlite.prepare(this.sql).all(...this.values) as T[] }; }
  execute() { return this.db.sqlite.prepare(this.sql).run(...this.values); }
  async run() { return this.execute(); }
}
class Database implements D1DatabaseBinding {
  beforeBatch: (() => void) | undefined;
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: D1StatementBinding[]) {
    const hook = this.beforeBatch; this.beforeBatch = undefined; hook?.();
    this.sqlite.exec('BEGIN');
    try { const results = statements.map(statement => (statement as Statement).execute()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const guest = '33333333-3333-4333-8333-333333333333';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
function setup() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = resolve('cloudflare/api/migrations');
  for (const file of readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(resolve(dir, file), 'utf8'));
  for (const id of [owner, other, guest]) sqlite.prepare('INSERT INTO users(id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .run(id, id === guest ? 'guest' : 'registered', new Date().toISOString());
  const db = new Database(sqlite);
  // These tests cover publishing at once; review-first mode has its own tests below.
  return { sqlite, db, env: { DB: db, MESSAGE_BOTTLE_REVIEW: 'post' } as unknown as ApiEnv };
}
async function call(env: ApiEnv, userId = owner, method = 'GET', body?: unknown, key = crypto.randomUUID(), query = '') {
  const request = new Request(`https://example.com/v1/message-bottles${query}`, {
    method, headers: { 'content-type': 'application/json', 'idempotency-key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handleMessageBottleRoute(request, env, userId);
  if (!response) throw new Error('留言路由未处理请求');
  return response;
}
const payload = { username: '小林', content: '希望增加阅读统计。' };

describe('D1 实名留言瓶', () => {
  it('持久绑定用户名，游客可浏览，公开响应不含私密身份', async () => {
    const { env, sqlite } = setup();
    const created = await call(env, owner, 'POST', payload);
    expect(created.status).toBe(201);
    const message = MessageBottleDtoSchema.parse(await created.json());
    expect(message).toMatchObject({ username: '小林', content: payload.content, isMine: true });
    const page = MessageBottlePageSchema.parse(await (await call(env, guest)).json());
    expect(page.items[0]).toMatchObject({ id: message.id, username: '小林', isMine: false });
    expect(JSON.stringify(page)).not.toContain(owner);
    expect(sqlite.prepare('SELECT username FROM users WHERE id = ?').get(owner)?.username).toBe('小林');
    const profile = await call(env, owner, 'GET', undefined, undefined, '/profile');
    expect(await profile.json()).toEqual({ username: '小林', canPost: true });
    await expect(call(env, guest, 'POST', payload)).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 403 });
  });
  it('同键并发重放只创建一次，不同内容冲突；署名不可冒用或更换', async () => {
    const { env, sqlite } = setup(); const key = crypto.randomUUID();
    const responses = await Promise.all([call(env, owner, 'POST', payload, key), call(env, owner, 'POST', payload, key)]);
    const messages = await Promise.all(responses.map(response => response.json()));
    expect(messages[0]).toEqual(messages[1]);
    expect(sqlite.prepare('SELECT count(*) AS total FROM message_bottles').get()?.total).toBe(1);
    await expect(call(env, owner, 'POST', { ...payload, content: '不同意见' }, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(call(env, owner, 'POST', { ...payload, username: '另一个名字' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(call(env, other, 'POST', payload)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await call(env, other, 'POST', { ...payload, username: 'Alice' });
    sqlite.prepare("UPDATE users SET kind = 'registered' WHERE id = ?").run(guest);
    await expect(call(env, guest, 'POST', { ...payload, username: 'ＡＬＩＣＥ' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(sqlite.prepare('SELECT count(*) AS total FROM transaction_guards').get()?.total).toBe(0);
  });
  it('相同时间按 ID 稳定分页，包含所有作者且不漏历史留言', async () => {
    const { env, sqlite } = setup();
    const timestamp = '2026-10-03T01:00:00.000Z';
    for (let i = 1; i <= 5; i++) sqlite.prepare('INSERT INTO message_bottles(id, user_id, username, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`00000000-0000-4000-8000-00000000000${i}`, i % 2 ? owner : other, i % 2 ? '小林' : '小张', `建议${i}`, timestamp);
    const ids: string[] = []; let cursor: string | null = null;
    do {
      const page = MessageBottlePageSchema.parse(await (await call(env, guest, 'GET', undefined, undefined,
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json());
      ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(5); expect(new Set(ids).size).toBe(5); expect(ids).toEqual([...ids].sort().reverse());
    await expect(call(env, owner, 'GET', undefined, undefined, '?cursor=invalid')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('并发发布不能超过每十分钟五条，重放不占新次数', async () => {
    const { env, sqlite } = setup(); const key = crypto.randomUUID();
    await call(env, owner, 'POST', payload, key);
    for (let i = 0; i < 3; i++) await call(env, owner, 'POST', { ...payload, content: `建议${i}` });
    const outcomes = await Promise.allSettled([call(env, owner, 'POST', payload), call(env, owner, 'POST', payload)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'RATE_LIMITED' } });
    expect(sqlite.prepare('SELECT count(*) AS total FROM message_bottles').get()?.total).toBe(5);
    expect((await call(env, owner, 'POST', payload, key)).status).toBe(201);
  });
  it('提交前身份失效时整批回滚用户名和幂等记录', async () => {
    const { env, db, sqlite } = setup();
    db.beforeBatch = () => { sqlite.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), owner); };
    await expect(call(env, owner, 'POST', payload)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(sqlite.prepare('SELECT username FROM users WHERE id = ?').get(owner)?.username).toBeNull();
    expect(sqlite.prepare('SELECT count(*) AS total FROM message_bottles').get()?.total).toBe(0);
    expect(sqlite.prepare('SELECT count(*) AS total FROM idempotency_records').get()?.total).toBe(0);
  });
  it('实际 Worker 分发要求 Bearer 身份并注册留言路由', async () => {
    const { env, sqlite } = setup();
    Object.assign(env, { API_STAGE_OPEN: 'true', JOB_QUEUE: {}, CPU_BOUNDARY: {}, IMPORT_BUCKET: {}, IMAGE_SERVICE: {},
      AI: {}, IMAGES: {}, EVOLINK_API_KEY: 'test-key', RESEND_API_KEY: 'test-key', PASSWORD_RESET_FROM_EMAIL: 'test@example.com' });
    const token = 'ab'.repeat(32);
    sqlite.prepare('INSERT INTO installations(id, user_id, token_hash) VALUES (?, ?, ?)')
      .run(crypto.randomUUID(), owner, await hashInstallationToken(token));
    const request = () => new Request('https://example.com/v1/message-bottles', { headers: { authorization: `Bearer ${token}` } });
    const rejected = await worker.fetch(new Request('https://example.com/v1/message-bottles'), env);
    expect(rejected.status).toBe(401);
    await call(env, owner, 'POST', payload);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(MessageBottlePageSchema.parse(await response.json()).items[0]?.username).toBe('小林');
  });
});

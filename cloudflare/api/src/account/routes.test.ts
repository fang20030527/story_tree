import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountProfileSchema, MessageBottlePageSchema } from '@context-reader/contracts';

import { handleMessageBottleRoute } from '../message-bottles/routes';
import worker from '../index';
import {
  AGE_CONFIRMED_AT, closeTestDatabases, createTestD1, insertUserWithToken,
} from '../test-support/sqlite-d1';
import { handleAccountRoute } from './routes';

// Node 本地验证 Worker 分发，Durable Object 导出由 Cloudflare 运行时提供。
vi.mock('../cpu/object', () => ({ CpuBoundary: class {} }));

afterEach(closeTestDatabases);

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const guest = '33333333-3333-4333-8333-333333333333';

function setup() {
  const context = createTestD1();
  const { sqlite } = context;
  const insert = (id: string, kind: string, username: string | null = null, deletedAt: string | null = null) =>
    sqlite.prepare('INSERT INTO users(id, kind, age_confirmed_at, username, username_key, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, AGE_CONFIRMED_AT, username, username?.toLowerCase() ?? null, deletedAt);
  insert(owner, 'registered', 'Old_Name');
  insert(other, 'registered', 'Alice');
  insert(guest, 'guest');
  const row = (id: string) => sqlite.prepare('SELECT kind, username, username_key FROM users WHERE id = ?')
    .get(id) as { kind: string; username: string | null; username_key: string | null };
  return { ...context, insert, row };
}

const call = (env: ReturnType<typeof setup>['env'], userId: string, method: string, path = '/v1/account', body?: unknown, headers: Record<string, string> = {}) =>
  handleAccountRoute(new Request(`https://example.com${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), env, userId);
const put = (env: ReturnType<typeof setup>['env'], userId: string, username: unknown) =>
  call(env, userId, 'PUT', '/v1/account/username', { username });

describe('GET /v1/account', () => {
  it('返回身份类型和用户名，游客用户名为空，且不缓存', async () => {
    const { env } = setup();
    const registered = (await call(env, owner, 'GET'))!;
    expect(registered.headers.get('cache-control')).toBe('no-store');
    expect(AccountProfileSchema.parse(await registered.json())).toEqual({ kind: 'registered', username: 'Old_Name' });
    expect(await (await call(env, guest, 'GET'))!.json()).toEqual({ kind: 'guest', username: null });
  });

  it('已注册但没有用户名的账号首次读取时补发：优先邮箱前缀，没有邮箱用 用户_ 名', async () => {
    const { env, insert, row, sqlite } = setup();
    insert('44444444-4444-4444-8444-444444444444', 'registered');
    insert('55555555-5555-4555-8555-555555555555', 'registered');
    sqlite.prepare("INSERT INTO email_accounts(id, user_id, email, password_hash) VALUES (?, ?, 'late.arrival@example.com', 'hash')")
      .run(crypto.randomUUID(), '44444444-4444-4444-8444-444444444444');

    const first = AccountProfileSchema.parse(await (await call(env, '44444444-4444-4444-8444-444444444444', 'GET'))!.json());
    expect(first.username).toBe('late.arrival');
    expect(row('44444444-4444-4444-8444-444444444444')).toMatchObject({ username: 'late.arrival', username_key: 'late.arrival' });
    const again = AccountProfileSchema.parse(await (await call(env, '44444444-4444-4444-8444-444444444444', 'GET'))!.json());
    expect(again.username).toBe('late.arrival');

    const noEmail = AccountProfileSchema.parse(await (await call(env, '55555555-5555-4555-8555-555555555555', 'GET'))!.json());
    expect(noEmail.username).toMatch(/^用户_[0-9a-f]{8}$/u);
  });

  it('补发时前缀已被占用则换一个，游客不会被补发，已删除账号视为凭据无效', async () => {
    const { env, insert, row, sqlite } = setup();
    insert('44444444-4444-4444-8444-444444444444', 'registered');
    sqlite.prepare("INSERT INTO email_accounts(id, user_id, email, password_hash) VALUES (?, ?, 'alice@example.com', 'hash')")
      .run(crypto.randomUUID(), '44444444-4444-4444-8444-444444444444');
    const profile = AccountProfileSchema.parse(await (await call(env, '44444444-4444-4444-8444-444444444444', 'GET'))!.json());
    expect(profile.username).toMatch(/^alice_[0-9a-f]{8}$/u);

    await call(env, guest, 'GET');
    expect(row(guest).username).toBeNull();

    insert('66666666-6666-4666-8666-666666666666', 'registered', null, '2026-10-02T00:00:00.000Z');
    await expect(call(env, '66666666-6666-4666-8666-666666666666', 'GET'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
  });
});

describe('PUT /v1/account/username', () => {
  it('修改用户名并返回新资料，名字按 NFKC 规范化，唯一键同步更新', async () => {
    const { env, row } = setup();
    const response = (await put(env, owner, '  Ｎew_Name.2  '))!;
    expect(response.status).toBe(200);
    expect(AccountProfileSchema.parse(await response.json())).toEqual({ kind: 'registered', username: 'New_Name.2' });
    expect(row(owner)).toEqual({ kind: 'registered', username: 'New_Name.2', username_key: 'new_name.2' });
  });

  it('提交与当前完全相同的名字是幂等的，不执行任何写入', async () => {
    const { env, db } = setup();
    const statements: string[] = [];
    db.onPrepare = sql => statements.push(sql);
    expect((await put(env, owner, 'Old_Name'))!.status).toBe(200);
    expect(statements.some(sql => /UPDATE users/iu.test(sql))).toBe(false);
  });

  it('只改大小写不算重名', async () => {
    const { env, row } = setup();
    expect((await put(env, owner, 'old_name'))!.status).toBe(200);
    expect(row(owner)).toMatchObject({ username: 'old_name', username_key: 'old_name' });
  });

  it('名字已被别人占用（忽略大小写和全角）返回 409，原名字保持不变', async () => {
    const { env, row } = setup();
    for (const name of ['Alice', 'alice', 'ＡＬＩＣＥ']) {
      await expect(put(env, owner, name)).rejects.toMatchObject({
        code: 'STATE_CONFLICT', statusCode: 409, message: '这个用户名已被使用，请换一个',
      });
    }
    expect(row(owner).username).toBe('Old_Name');
  });

  it('检查之后、写入之前被别人占用：由唯一索引兜底并返回 409', async () => {
    const { env, db, insert, row } = setup();
    db.onPrepare = sql => {
      if (!/UPDATE users SET username/iu.test(sql)) return;
      db.onPrepare = undefined;
      insert(crypto.randomUUID(), 'registered', 'Racer');
    };
    await expect(put(env, owner, 'racer')).rejects.toMatchObject({ code: 'STATE_CONFLICT', statusCode: 409 });
    expect(row(owner).username).toBe('Old_Name');
  });

  it('与用户名无关的写入失败原样抛出', async () => {
    const { env, db } = setup();
    const failure = new Error('D1 unavailable');
    db.onPrepare = sql => {
      if (/UPDATE users SET username/iu.test(sql)) throw failure;
    };
    await expect(put(env, owner, 'Fresh_Name')).rejects.toBe(failure);
  });

  it('游客不能设置用户名', async () => {
    const { env, row } = setup();
    await expect(put(env, guest, 'Guest_Name')).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 403 });
    expect(row(guest).username).toBeNull();
  });

  it('已删除账号返回凭据无效，不会写入', async () => {
    const { env, insert, row } = setup();
    insert('66666666-6666-4666-8666-666666666666', 'registered', 'Gone', '2026-10-02T00:00:00.000Z');
    await expect(put(env, '66666666-6666-4666-8666-666666666666', 'Back_Again'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    expect(row('66666666-6666-4666-8666-666666666666').username).toBe('Gone');
  });

  it('不合法的输入返回 400 和具体提示', async () => {
    const { env, row } = setup();
    const cases: Array<[unknown, string]> = [
      ['a', '用户名需为 2–24 个字符'],
      ['a'.repeat(25), '用户名需为 2–24 个字符'],
      ['a@b.com', '用户名只能包含文字、数字、下划线、点、连字符和间隔号'],
      ['😀😀', '用户名只能包含文字、数字、下划线、点、连字符和间隔号'],
      ['..', '用户名需至少包含一个文字或数字'],
      ['Admin', '这个用户名不可使用，请换一个'],
      ['  ', '请输入用户名'],
    ];
    for (const [username, message] of cases) {
      await expect(put(env, owner, username), String(username)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR', statusCode: 400, message,
      });
    }
    for (const body of [{}, { username: 5 }, { username: 'Fine_Name', userId: other }, []]) {
      await expect(call(env, owner, 'PUT', '/v1/account/username', body))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    await expect(call(env, owner, 'PUT', '/v1/account/username', 'not json'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(row(owner).username).toBe('Old_Name');
  });

  it('只接受规定的请求方式，其他路径不处理', async () => {
    const { env } = setup();
    await expect(call(env, owner, 'POST')).rejects.toMatchObject({ statusCode: 405 });
    await expect(call(env, owner, 'GET', '/v1/account/username')).rejects.toMatchObject({ statusCode: 405 });
    await expect(call(env, owner, 'PATCH', '/v1/account/username', { username: 'Fine_Name' })).rejects.toMatchObject({ statusCode: 405 });
    expect(await call(env, owner, 'GET', '/v1/account/other')).toBeNull();
    expect(await call(env, owner, 'GET', '/v1/message-bottles')).toBeNull();
  });
});

describe('与留言瓶的配合', () => {
  const bottle = (env: ReturnType<typeof setup>['env'], userId: string, body: unknown, method = 'POST', query = '') =>
    handleMessageBottleRoute(new Request(`https://example.com/v1/message-bottles${query}`, {
      method,
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }), env, userId);

  it('改名后只能以新名字留言，已发布的留言保留当时的署名', async () => {
    const { env } = setup();
    expect((await bottle(env, owner, { username: 'Old_Name', content: '改名前的留言' }))!.status).toBe(201);
    await put(env, owner, 'New_Name');
    await expect(bottle(env, owner, { username: 'Old_Name', content: '继续用旧名' }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '请使用账号已设置的用户名' });
    expect((await bottle(env, owner, { username: 'New_Name', content: '改名后的留言' }))!.status).toBe(201);

    const page = MessageBottlePageSchema.parse(await (await bottle(env, guest, undefined, 'GET'))!.json());
    expect(page.items.map(item => [item.username, item.content])).toEqual([
      ['New_Name', '改名后的留言'], ['Old_Name', '改名前的留言'],
    ]);
    const profile = await (await handleMessageBottleRoute(new Request('https://example.com/v1/message-bottles/profile'), env, owner))!.json();
    expect(profile).toEqual({ username: 'New_Name', canPost: true });
  });

  it('旧名字释放后可以被别人使用', async () => {
    const { env, row } = setup();
    await put(env, owner, 'New_Name');
    expect((await put(env, other, 'Old_Name'))!.status).toBe(200);
    expect(row(other).username).toBe('Old_Name');
  });
});

describe('Worker 分发', () => {
  it('需要 Bearer 身份；已登录账号可以读取和修改用户名', async () => {
    const { env, sqlite } = setup();
    Object.assign(env, { API_STAGE_OPEN: 'true', JOB_QUEUE: {}, CPU_BOUNDARY: {}, IMPORT_BUCKET: {}, IMAGE_SERVICE: {},
      AI: {}, IMAGES: {}, EVOLINK_API_KEY: 'test-key', RESEND_API_KEY: 'test-key', PASSWORD_RESET_FROM_EMAIL: 'test@example.com' });
    const token = await insertUserWithToken(sqlite, '77777777-7777-4777-8777-777777777777', 'registered');
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    expect((await worker.fetch(new Request('https://example.com/v1/account'), env)).status).toBe(401);
    const read = await worker.fetch(new Request('https://example.com/v1/account', { headers }), env);
    expect(read.status).toBe(200);
    expect(AccountProfileSchema.parse(await read.json()).kind).toBe('registered');

    const update = await worker.fetch(new Request('https://example.com/v1/account/username', {
      method: 'PUT', headers, body: JSON.stringify({ username: 'Via_Worker' }),
    }), env);
    expect(update.status).toBe(200);
    expect(update.headers.get('cache-control')).toBe('no-store');
    expect(AccountProfileSchema.parse(await update.json())).toEqual({ kind: 'registered', username: 'Via_Worker' });

    const taken = await worker.fetch(new Request('https://example.com/v1/account/username', {
      method: 'PUT', headers, body: JSON.stringify({ username: 'alice' }),
    }), env);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: 'STATE_CONFLICT', retryable: false } });

    const preflight = await worker.fetch(new Request('https://example.com/v1/account/username', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'PUT' },
    }), env);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
  });
});

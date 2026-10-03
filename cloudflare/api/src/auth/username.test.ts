import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnonymousAuthResponseSchema, EmailAuthResponseSchema } from '@context-reader/contracts';

import { closeTestDatabases, createTestD1, insertUserWithToken, AGE_CONFIRMED_AT } from '../test-support/sqlite-d1';
import { handleAuthRoute } from './index';
import { deriveUsernameBase, generatedUsernameCandidates } from './username';

const { hashPassword, wechatExchange } = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  wechatExchange: vi.fn(),
}));
vi.mock('../cpu/client', () => ({
  hashEmailPasswordOnCpuBoundary: hashPassword,
  verifyEmailPasswordOnCpuBoundary: async (_env: unknown, password: string, hash: string) => hash === `hash:${password}`,
}));
vi.mock('../../../../server/src/modules/auth/wechat-client', () => ({
  createWechatClient: () => ({ exchangeCode: wechatExchange }),
}));

const PASSWORD = 'correct-horse-battery';
const guestId = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

beforeEach(() => {
  hashPassword.mockReset().mockImplementation(async (_env: unknown, password: string) => `hash:${password}`);
  wechatExchange.mockReset();
});
afterEach(closeTestDatabases);

async function setup(guests = 1) {
  const context = createTestD1();
  const tokens: string[] = [];
  for (let n = 1; n <= guests; n++) tokens.push(await insertUserWithToken(context.sqlite, guestId(n)));
  const post = (path: string, token: string, body: unknown) => handleAuthRoute(new Request(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }), context.env);
  const email = (n: number, body: Record<string, unknown>) => post('/v1/auth/email', tokens[n - 1]!, body);
  const row = (n: number) => context.sqlite.prepare('SELECT kind, username, username_key FROM users WHERE id = ?')
    .get(guestId(n)) as { kind: string; username: string | null; username_key: string | null };
  const count = (table: string) => (context.sqlite.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number }).total;
  return { ...context, tokens, email, post, row, count };
}

describe('邮箱注册时的用户名', () => {
  it('新版客户端指定用户名：与账号一起原子保存，键忽略大小写和全角，响应结构不变', async () => {
    const { email, row } = await setup();
    const response = (await email(1, { email: 'Reader@Example.com', password: PASSWORD, username: 'Ａlice' }))!;
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(EmailAuthResponseSchema.parse(body)).toMatchObject({ userId: guestId(1), kind: 'registered' });
    expect(Object.keys(body as object).sort()).toEqual(['kind', 'remainingFreePractices', 'userId']);
    expect(row(1)).toEqual({ kind: 'registered', username: 'Alice', username_key: 'alice' });
  });

  it('旧版客户端不传用户名也能注册：取邮箱前缀，重名的后来者自动区分', async () => {
    const { email, row, count } = await setup(2);
    expect((await email(1, { email: 'reader@example.com', password: PASSWORD }))!.status).toBe(201);
    expect((await email(2, { email: 'reader@other.org', password: PASSWORD }))!.status).toBe(201);
    expect(row(1).username).toBe('reader');
    expect(row(2).username).toMatch(/^reader_[0-9a-f]{8}$/u);
    expect(count('email_accounts')).toBe(2);
  });

  it('邮箱前缀不适合公开展示（含手机号、保留字、过短）时使用 用户_ 兜底名', async () => {
    const { email, row } = await setup(3);
    await email(1, { email: 'fzy13967021190@gmail.com', password: PASSWORD });
    await email(2, { email: 'admin@example.com', password: PASSWORD });
    await email(3, { email: 'x@example.com', password: PASSWORD });
    for (const n of [1, 2, 3]) expect(row(n).username, `账号 ${n}`).toMatch(/^用户_[0-9a-f]{8}$/u);
    expect(row(1).username).not.toContain('1396');
  });

  it('指定的用户名已被占用：返回 409，不创建账号，也不做密码哈希', async () => {
    const { email, row, count, sqlite } = await setup();
    sqlite.prepare("INSERT INTO users(id, kind, age_confirmed_at, username, username_key) VALUES (?, 'registered', ?, 'Alice', 'alice')")
      .run(crypto.randomUUID(), AGE_CONFIRMED_AT);
    for (const username of ['alice', 'ALICE', 'ＡＬＩＣＥ']) {
      await expect(email(1, { email: 'reader@example.com', password: PASSWORD, username }))
        .rejects.toMatchObject({ code: 'STATE_CONFLICT', statusCode: 409, message: '这个用户名已被使用，请换一个' });
    }
    expect(hashPassword).not.toHaveBeenCalled();
    expect(count('email_accounts')).toBe(0);
    expect(row(1)).toEqual({ kind: 'guest', username: null, username_key: null });
  });

  it('检查之后、写入之前被别人抢走用户名：整批回滚，账号不会被创建', async () => {
    const { email, row, count, sqlite, db } = await setup();
    db.beforeBatch = () => sqlite.prepare("INSERT INTO users(id, kind, age_confirmed_at, username, username_key) VALUES (?, 'registered', ?, 'Bob', 'bob')")
      .run(crypto.randomUUID(), AGE_CONFIRMED_AT);
    await expect(email(1, { email: 'reader@example.com', password: PASSWORD, username: 'bob' }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', statusCode: 409 });
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(count('email_accounts')).toBe(0);
    expect(row(1)).toEqual({ kind: 'guest', username: null, username_key: null });
  });

  it('自动生成的候选名被并发占用时换下一个候选继续注册', async () => {
    const { email, row, sqlite, db } = await setup();
    db.beforeBatch = () => sqlite.prepare("INSERT INTO users(id, kind, age_confirmed_at, username, username_key) VALUES (?, 'registered', ?, 'reader', 'reader')")
      .run(crypto.randomUUID(), AGE_CONFIRMED_AT);
    expect((await email(1, { email: 'reader@example.com', password: PASSWORD }))!.status).toBe(201);
    expect(row(1).username).toMatch(/^reader_[0-9a-f]{8}$/u);
    expect(db.batches).toBe(2);
  });

  it('与用户名无关的批处理失败会原样抛出，不会被当成重名重试', async () => {
    const { email, row, db } = await setup();
    const failure = new Error('D1 unavailable');
    const original = db.batch.bind(db);
    db.batch = async () => { throw failure; };
    await expect(email(1, { email: 'reader@example.com', password: PASSWORD, username: 'Alice' })).rejects.toBe(failure);
    db.batch = original;
    expect(row(1)).toEqual({ kind: 'guest', username: null, username_key: null });
  });

  it('已有邮箱账号登录时忽略请求里的用户名，不改变现有名字', async () => {
    const { email, row, sqlite } = await setup(2);
    await email(1, { email: 'reader@example.com', password: PASSWORD, username: 'Alice' });
    const login = (await email(2, { email: 'reader@example.com', password: PASSWORD, username: 'Other' }))!;
    expect(login.status).toBe(200);
    expect(row(1).username).toBe('Alice');
    expect(sqlite.prepare("SELECT count(*) AS total FROM users WHERE username_key = 'other'").get()).toEqual({ total: 0 });
    await expect(email(2, { email: 'reader@example.com', password: 'wrong-password-1', username: 'Other' }))
      .rejects.toMatchObject({ code: 'EMAIL_AUTH_FAILED' });
  });

  it('已注册账号再绑定新邮箱时保留原用户名，也不会因被忽略的名字误报重名', async () => {
    const { email, row, count, sqlite } = await setup();
    await email(1, { email: 'first@example.com', password: PASSWORD, username: 'Alice' });
    sqlite.prepare("INSERT INTO users(id, kind, age_confirmed_at, username, username_key) VALUES (?, 'registered', ?, 'Taken', 'taken')")
      .run(crypto.randomUUID(), AGE_CONFIRMED_AT);
    expect((await email(1, { email: 'second@example.com', password: PASSWORD, username: 'Taken' }))!.status).toBe(201);
    expect(row(1).username).toBe('Alice');
    expect(count('email_accounts')).toBe(2);
  });

  it('不合法的用户名返回 400 和对应提示，且不创建任何数据', async () => {
    const { email, count } = await setup();
    const cases: Array<[string, string]> = [
      ['a@b.com', '用户名只能包含文字、数字、下划线、点、连字符和间隔号'],
      ['a', '用户名需为 2–24 个字符'],
      ['', '用户名需为 2–24 个字符'],
      ['..', '用户名需至少包含一个文字或数字'],
      ['Admin', '这个用户名不可使用，请换一个'],
    ];
    for (const [username, message] of cases) {
      const attempt = email(1, { email: 'reader@example.com', password: PASSWORD, username });
      // 空字符串在 checkUsername 中提示"请输入用户名"，注册请求把它视为不合法的用户名。
      await expect(attempt).rejects.toMatchObject({
        code: 'VALIDATION_ERROR', statusCode: 400, message: username === '' ? '请输入用户名' : message,
      });
    }
    await expect(email(1, { email: 'not-an-email', password: PASSWORD, username: 'Alice' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '邮箱或密码格式无效' });
    await expect(email(1, { email: 'reader@example.com', password: 'short', username: 'Alice' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '邮箱或密码格式无效' });
    await expect(email(1, { email: 'reader@example.com', password: PASSWORD, nickname: 'Alice' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '邮箱或密码格式无效' });
    expect(count('email_accounts')).toBe(0);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('同一邮箱在查询与写入之间被抢先注册：输家的批处理不写用户名，随后按登录处理', async () => {
    const { email, row, count, sqlite, db } = await setup();
    const winner = crypto.randomUUID();
    db.beforeBatch = () => {
      sqlite.prepare("INSERT INTO users(id, kind, age_confirmed_at, username, username_key) VALUES (?, 'registered', ?, 'Winner', 'winner')")
        .run(winner, AGE_CONFIRMED_AT);
      sqlite.prepare(`INSERT INTO email_accounts(id, user_id, email, password_hash)
        VALUES (?, ?, 'reader@example.com', ?)`).run(crypto.randomUUID(), winner, `hash:${PASSWORD}`);
    };
    const response = (await email(1, { email: 'reader@example.com', password: PASSWORD, username: 'Loser' }))!;
    expect(response.status).toBe(200);
    expect((await response.json() as { userId: string }).userId).toBe(winner);
    expect(row(1)).toEqual({ kind: 'guest', username: null, username_key: null });
    expect(sqlite.prepare("SELECT count(*) AS total FROM users WHERE username_key = 'loser'").get()).toEqual({ total: 0 });
    expect(count('email_accounts')).toBe(1);
  });

  it('两个设备并发注册同一邮箱：只有创建者的用户名被保存', async () => {
    const { email, row, count, sqlite } = await setup(2);
    const [first, second] = await Promise.all([
      email(1, { email: 'reader@example.com', password: PASSWORD, username: 'One' }),
      email(2, { email: 'reader@example.com', password: PASSWORD, username: 'Two' }),
    ]);
    expect([first!.status, second!.status].sort()).toEqual([200, 201]);
    expect(count('email_accounts')).toBe(1);
    expect(sqlite.prepare("SELECT username FROM users WHERE username IS NOT NULL").all()).toHaveLength(1);
    expect(['One', 'Two']).toContain(row(1).username ?? row(2).username);
  });
});

describe('微信注册时的用户名', () => {
  it('自动生成 用户_ 名，不使用也不泄露 openid 或 unionid', async () => {
    wechatExchange.mockResolvedValue({ openid: 'openid-secret-1', unionid: 'unionid-secret-1' });
    const { post, tokens, row } = await setup();
    const response = (await post('/v1/auth/wechat', tokens[0]!, { code: 'wx-code' }))!;
    expect(response.status).toBe(201);
    expect(EmailAuthResponseSchema.parse(await response.json()).kind).toBe('registered');
    expect(row(1).kind).toBe('registered');
    expect(row(1).username).toMatch(/^用户_[0-9a-f]{8}$/u);
    expect(JSON.stringify(row(1))).not.toMatch(/secret/u);
  });

  it('重复登录同一个微信号不会改动已分配的用户名', async () => {
    wechatExchange.mockResolvedValue({ openid: 'openid-1', unionid: 'unionid-1' });
    const { post, tokens, row } = await setup(2);
    await post('/v1/auth/wechat', tokens[0]!, { code: 'a' });
    const name = row(1).username;
    expect((await post('/v1/auth/wechat', tokens[1]!, { code: 'b' }))!.status).toBe(200);
    expect(row(1).username).toBe(name);
  });
});

describe('匿名身份', () => {
  it('游客没有用户名，匿名注册响应保持不变', async () => {
    const { env, sqlite } = createTestD1();
    const response = (await handleAuthRoute(new Request('https://example.com/v1/auth/anonymous', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${'cd'.repeat(32)}` },
      body: JSON.stringify({ ageConfirmed14Plus: true }),
    }), env))!;
    expect(response.status).toBe(201);
    expect(AnonymousAuthResponseSchema.parse(await response.json()).kind).toBe('guest');
    expect(sqlite.prepare('SELECT kind, username, username_key FROM users').all())
      .toEqual([{ kind: 'guest', username: null, username_key: null }]);
  });
});

describe('自动生成的候选名', () => {
  it('邮箱前缀可用时依次为前缀、带随机后缀的前缀、兜底名', () => {
    let counter = 0;
    const random = (length: number) => String(++counter).padStart(length, '0');
    expect(generatedUsernameCandidates('reader@example.com', random)).toEqual([
      'reader', 'reader_00000001', 'reader_00000002', 'reader_00000003',
      '用户_00000004', '用户_00000005', '用户_00000006',
    ]);
  });

  it('没有邮箱或前缀不可用时只有兜底名；过长前缀会为后缀留出空间', () => {
    expect(generatedUsernameCandidates(null, () => 'abcdef12')).toEqual(['用户_abcdef12', '用户_abcdef12', '用户_abcdef12']);
    expect(generatedUsernameCandidates('admin@example.com', () => 'abcdef12')[0]).toBe('用户_abcdef12');
    const long = generatedUsernameCandidates(`${'a'.repeat(30)}@example.com`, () => 'abcdef12');
    expect(long[0]).toBe('a'.repeat(24));
    expect(long[1]).toBe(`${'a'.repeat(15)}_abcdef12`);
    expect(long.every(name => name.length <= 24)).toBe(true);
  });

  it('前缀规则：小写、+ 和 \' 换成下划线、拒绝手机号和保留字', () => {
    expect(deriveUsernameBase('John.Smith+news@gmail.com')).toBe('john.smith_news');
    expect(deriveUsernameBase("O'Neil@x.com")).toBe('o_neil');
    expect(deriveUsernameBase('user12345@x.com')).toBe('user12345');
    for (const email of ['13967021190@163.com', 'a@x.com', '@x.com', 'plain', 'Admin@x.com', 'a.d.m.i.n@x.com', '..@x.com']) {
      expect(deriveUsernameBase(email), email).toBeNull();
    }
  });
});

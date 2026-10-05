import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MessageBottlePageSchema, MessageBottleReviewedPageSchema, MessageBottleThreadPageSchema,
  MessageBottleModerationPageSchema, MessageBottleThreadDtoSchema,
} from '@context-reader/contracts';
import { handleDeveloperMessageBottleRoute } from './developer';
import { handleMessageBottleRoute } from './routes';
import { createTestD1, closeTestDatabases, insertUserWithToken } from '../test-support/sqlite-d1';
import worker from '../index';

vi.mock('../cpu/object', () => ({ CpuBoundary: class {} }));
afterEach(closeTestDatabases);
const developer = '11111111-1111-4111-8111-111111111111';
const author = '22222222-2222-4222-8222-222222222222';
const reader = '33333333-3333-4333-8333-333333333333';
const guest = '44444444-4444-4444-8444-444444444444';
const bottleId = '55555555-5555-4555-8555-555555555555';
const base = 'https://example.com';
const createdAt = '2026-10-05T00:00:00.000Z';
async function setup() {
  const ctx = createTestD1();
  const tokens = new Map<string, string>();
  for (const id of [developer, author, reader, guest]) tokens.set(id, await insertUserWithToken(ctx.sqlite, id, id === guest ? 'guest' : 'registered'));
  ctx.sqlite.prepare('INSERT INTO message_bottles (id, user_id, username, content, created_at, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bottleId, author, '读者', '希望增加学习统计', createdAt, 'pending');
  ctx.env.DEVELOPER_USER_IDS = ` ${developer} `;
  return { ...ctx, tokens };
}
function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`${base}${path}`, { method, headers: { 'content-type': 'application/json' },
    ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
const path = `/v1/developer/message-bottles/${bottleId}`;
async function call(env: ReturnType<typeof createTestD1>['env'], url: string, method = 'GET', body?: unknown, userId = developer) {
  const res = await handleDeveloperMessageBottleRoute(request(url, method, body), env, userId);
  if (!res) throw new Error('开发者路由未处理');
  return res;
}
async function feed(env: ReturnType<typeof createTestD1>['env'], userId: string, query = '?includeReply=1') {
  return (await handleMessageBottleRoute(request(`/v1/message-bottles${query}`), env, userId))!.json();
}

describe('留言瓶开发者账号', () => {
  it('权限只由服务端账号 ID 决定，游客、普通账号和注销账号不能获得权限', async () => {
    const { env, sqlite } = await setup();
    expect(await (await call(env, '/v1/developer/access')).json()).toEqual({ canModerate: true });
    expect(await (await call(env, '/v1/developer/access', 'GET', undefined, author)).json()).toEqual({ canModerate: false });
    env.DEVELOPER_USER_IDS = `${guest},${developer}`;
    expect(await (await call(env, '/v1/developer/access', 'GET', undefined, guest)).json()).toEqual({ canModerate: false });
    sqlite.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(createdAt, developer);
    expect(await (await call(env, '/v1/developer/access')).json()).toEqual({ canModerate: false });
    delete env.DEVELOPER_USER_IDS;
    await expect(call(env, '/v1/developer/message-bottles')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('所有审核、禁言和回复接口拒绝普通账号，撤销白名单立即生效', async () => {
    const { env } = await setup();
    for (const [url, method] of [
      ['/v1/developer/message-bottles', 'GET'], ...['approve', 'hide', 'delete'].map(action => [`${path}/${action}`, 'POST']),
      ...['ban', 'unban'].map(action => [`/v1/developer/users/${author}/${action}`, 'POST']),
      [`${path}/reply`, 'PUT'], [`${path}/reply`, 'DELETE'],
    ]) await expect(call(env, url!, method!, { content: '回复' }, author)).rejects.toMatchObject({ statusCode: 403 });
    env.DEVELOPER_USER_IDS = author;
    await expect(call(env, `${path}/reply`, 'PUT', { content: '回复' })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('Worker 入口先校验安装令牌，不依赖 ADMIN_TOKEN，伪造头与已撤销令牌无效', async () => {
    const { env, tokens, sqlite } = await setup();
    Object.assign(env, { API_STAGE_OPEN: 'true', JOB_QUEUE: {}, CPU_BOUNDARY: {}, IMPORT_BUCKET: {}, IMAGE_SERVICE: {},
      AI: {}, IMAGES: {}, EVOLINK_API_KEY: 'fake', RESEND_API_KEY: 'fake', PASSWORD_RESET_FROM_EMAIL: 'test@example.com', API_CORS_ORIGINS: base });
    const get = (token?: string) => worker.fetch(new Request(`${base}/v1/developer/message-bottles`, {
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-developer': 'true', 'x-user-id': developer },
    }), env);
    expect((await get()).status).toBe(401);
    expect((await get(tokens.get(author))).status).toBe(403);
    expect((await get(tokens.get(developer))).status).toBe(200);
    sqlite.prepare('UPDATE installations SET revoked_at = ? WHERE user_id = ?').run(createdAt, developer);
    expect((await get(tokens.get(developer))).status).toBe(401);
  });

  it('分页遍历同时间的留言，不接受异常筛选和重复参数', async () => {
    const { env, sqlite } = await setup();
    for (let i = 0; i < 3; i++) sqlite.prepare('INSERT INTO message_bottles (id,user_id,username,content,created_at,status) VALUES (?,?,?,?,?,?)')
      .run(crypto.randomUUID(), author, '读者', `留言 ${i}`, createdAt, 'pending');
    const first = MessageBottleModerationPageSchema.parse(await (await call(env, '/v1/developer/message-bottles?limit=2')).json());
    const second = MessageBottleModerationPageSchema.parse(await (await call(env, `/v1/developer/message-bottles?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)).json());
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4);
    expect(second.nextCursor).toBeNull();
    for (const query of ['view=__proto__', 'view=constructor', 'view=pending&view=recent', 'cursor=bad', 'limit=51'])
      await expect(call(env, `/v1/developer/message-bottles?${query}`)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('回复随原留言可见，保存不自动通过，相同内容重放保持时间且旧契约不变', async () => {
    const { env, sqlite } = await setup();
    const response = await call(env, `${path}/reply`, 'PUT', { content: ' 谢谢建议！ ' });
    const saved = await response.json();
    expect(await (await call(env, `${path}/reply`, 'PUT', { content: '谢谢建议！' })).json()).toEqual(saved);
    expect(sqlite.prepare('SELECT status FROM message_bottles WHERE id = ?').get(bottleId)?.status).toBe('pending');
    expect(MessageBottleThreadPageSchema.parse(await feed(env, reader)).items).toHaveLength(0);
    expect(MessageBottleThreadPageSchema.parse(await feed(env, author)).items[0]?.reply?.content).toBe('谢谢建议！');
    await call(env, `${path}/approve`, 'POST');
    const page = MessageBottleThreadPageSchema.parse(await feed(env, reader));
    expect(page.items[0]?.reply?.content).toBe('谢谢建议！');
    expect(JSON.stringify(page)).not.toContain(developer);
    expect(JSON.stringify(page)).not.toContain(author);
    const old = MessageBottlePageSchema.parse(await feed(env, reader, ''));
    const reviewed = MessageBottleReviewedPageSchema.parse(await feed(env, reader, '?includeStatus=1'));
    expect(old.items[0]).not.toHaveProperty('reply');
    expect(reviewed.items[0]).not.toHaveProperty('reply');
    await call(env, `${path}/reply`, 'PUT', { content: '已经安排。' });
    expect(MessageBottleThreadPageSchema.parse(await feed(env, reader)).items[0]?.reply?.content).toBe('已经安排。');
    await call(env, `${path}/hide`, 'POST');
    expect(MessageBottleThreadPageSchema.parse(await feed(env, reader)).items).toHaveLength(0);
    await call(env, `${path}/reply`, 'DELETE');
    await call(env, `${path}/reply`, 'DELETE');
    expect(MessageBottleThreadPageSchema.parse(await feed(env, author)).items[0]?.reply).toBeNull();
  });

  it('屏蔽和举报同时隐藏回复，审核处理举报后可继续管理作者', async () => {
    const { env, sqlite } = await setup();
    await call(env, `${path}/reply`, 'PUT', { content: '已收到' });
    await call(env, `${path}/approve`, 'POST');
    await handleMessageBottleRoute(request(`/v1/message-bottles/${bottleId}/report`, 'POST', { reason: 'spam' }), env, reader);
    expect(MessageBottleThreadPageSchema.parse(await feed(env, reader)).items).toHaveLength(0);
    const reported = MessageBottleModerationPageSchema.parse(await (await call(env, '/v1/developer/message-bottles?view=reported')).json());
    expect(reported.items[0]?.reports).toHaveLength(1);
    await call(env, `${path}/approve`, 'POST');
    expect(sqlite.prepare('SELECT resolved_at FROM message_bottle_reports').get()?.resolved_at).toBeTruthy();
    await handleMessageBottleRoute(request(`/v1/message-bottles/${bottleId}/block`, 'POST'), env, guest);
    expect(MessageBottleThreadPageSchema.parse(await feed(env, guest)).items).toHaveLength(0);
    await call(env, `/v1/developer/users/${author}/ban`, 'POST');
    expect(sqlite.prepare('SELECT status FROM message_bottles WHERE id = ?').get(bottleId)?.status).toBe('hidden');
    await call(env, `/v1/developer/users/${author}/unban`, 'POST');
    expect(sqlite.prepare('SELECT posting_banned_at FROM user_moderation WHERE user_id = ?').get(author)?.posting_banned_at).toBeNull();
  });

  it('限制回复内容，拒绝指定作者和不存在的留言', async () => {
    const { env } = await setup();
    for (const body of [{ content: '  ' }, { content: 'a'.repeat(1001) }, { content: '冒充', userId: author }])
      await expect(call(env, `${path}/reply`, 'PUT', body)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(call(env, `/v1/developer/message-bottles/${crypto.randomUUID()}/reply`, 'PUT', { content: '回复' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('新版创建契约与幂等重放均包含当前回复，老版重放仍不增加字段', async () => {
    const { env } = await setup();
    const key = crypto.randomUUID();
    const create = async (query: string) => {
      const req = request('/v1/message-bottles' + query, 'POST', { username: '读者', content: '新增留言' });
      req.headers.set('idempotency-key', key);
      return (await handleMessageBottleRoute(req, env, author))!.json();
    };
    const created = MessageBottleThreadDtoSchema.parse(await create('?includeReply=1'));
    expect(created.reply).toBeNull();
    await call(env, `/v1/developer/message-bottles/${created.id}/reply`, 'PUT', { content: '已收到' });
    expect(MessageBottleThreadDtoSchema.parse(await create('?includeReply=1')).reply?.content).toBe('已收到');
    expect(await create('?includeStatus=1')).not.toHaveProperty('reply');
    expect(await create('')).not.toHaveProperty('reply');
  });

  it.each(['bottle', 'author', 'developer'])('删除 %s 后级联清理回复', async subject => {
    const { env, sqlite } = await setup();
    await call(env, `${path}/reply`, 'PUT', { content: '回复' });
    if (subject === 'bottle') await call(env, `${path}/delete`, 'POST');
    else sqlite.prepare('DELETE FROM users WHERE id = ?').run(subject === 'author' ? author : developer);
    expect(sqlite.prepare('SELECT count(*) AS n FROM message_bottle_replies').get()?.n).toBe(0);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });
});

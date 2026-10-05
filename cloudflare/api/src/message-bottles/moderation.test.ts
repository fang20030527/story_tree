import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BlockedUsersSchema, MessageBottlePageSchema, MessageBottleReviewedDtoSchema,
  MessageBottleReviewedPageSchema,
} from '@context-reader/contracts';

import { handleModerationRoute } from '../admin/moderation';
import type { ApiEnv } from '../env';
import { AGE_CONFIRMED_AT, closeTestDatabases, createTestD1 } from '../test-support/sqlite-d1';
import { handleMessageBottleRoute, REPORTS_TO_HIDE } from './routes';

const author = '11111111-1111-4111-8111-111111111111';
const readers = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'] as const;
const base = 'https://blackholeenglish.com';
const ADMIN_TOKEN = 'moderator-secret-token-0123456789';

afterEach(() => { closeTestDatabases(); vi.unstubAllGlobals(); });

function setup(review: 'pre' | 'post' = 'pre') {
  const { sqlite, db } = createTestD1();
  for (const [index, id] of [author, ...readers].entries()) {
    sqlite.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)').run(id, 'registered', AGE_CONFIRMED_AT);
    if (index > 0) sqlite.prepare('UPDATE users SET username = ?, username_key = ? WHERE id = ?').run(`reader${index}`, `reader${index}`, id);
  }
  const env = { DB: db, MESSAGE_BOTTLE_REVIEW: review, ADMIN_TOKEN } as unknown as ApiEnv;
  return { sqlite, env };
}

async function call(env: ApiEnv, userId: string, path: string, method = 'GET', body?: unknown) {
  const response = await handleMessageBottleRoute(new Request(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, userId);
  if (!response) throw new Error('route did not handle the request');
  return response;
}

async function post(env: ApiEnv, content = '希望增加更多影片。') {
  return MessageBottleReviewedDtoSchema.parse(await (await call(env, author, '/v1/message-bottles?includeStatus=1',
    'POST', { username: '小林', content })).json());
}

const visibleTo = async (env: ApiEnv, userId: string) =>
  MessageBottlePageSchema.parse(await (await call(env, userId, '/v1/message-bottles')).json()).items.map((item) => item.id);

function admin(env: ApiEnv, path: string, method = 'GET', token = ADMIN_TOKEN) {
  return handleModerationRoute(new Request(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '203.0.113.5' },
  }), env);
}

describe('留言瓶审核', () => {
  it('先审后发：新留言只有作者能看到并显示审核中，通过后所有人可见', async () => {
    const { env } = setup('pre');
    const bottle = await post(env);
    expect(bottle.status).toBe('pending');
    expect(await visibleTo(env, readers[0])).toEqual([]);
    const own = MessageBottleReviewedPageSchema.parse(await (await call(env, author, '/v1/message-bottles?includeStatus=1')).json());
    expect(own.items.map((item) => [item.id, item.status])).toEqual([[bottle.id, 'pending']]);
    // Older clients still get the original page shape.
    MessageBottlePageSchema.parse(await (await call(env, author, '/v1/message-bottles')).json());

    const queue = await (await admin(env, '/v1/admin/message-bottles?view=pending'))!.json() as { items: Array<{ id: string }> };
    expect(queue.items.map((item) => item.id)).toEqual([bottle.id]);
    expect((await admin(env, `/v1/admin/message-bottles/${bottle.id}/approve`, 'POST'))!.status).toBe(200);
    expect(await visibleTo(env, readers[0])).toEqual([bottle.id]);
  });

  it('举报后举报人立即看不到；三人举报后自动隐藏，等待审核', async () => {
    const { env } = setup('post');
    const bottle = await post(env);
    await expect(call(env, author, `/v1/message-bottles/${bottle.id}/report`, 'POST', { reason: 'spam' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const [index, reader] of readers.entries()) {
      expect((await call(env, reader, `/v1/message-bottles/${bottle.id}/report`, 'POST',
        { reason: 'abuse', detail: '人身攻击' })).status).toBe(204);
      expect(await visibleTo(env, reader)).toEqual([]);
      // Below the threshold the bottle stays public for people who did not report it.
      if (index < REPORTS_TO_HIDE - 1) expect(await visibleTo(env, readers[2])).toEqual([bottle.id]);
    }
    const page = await (await admin(env, '/v1/admin/message-bottles?view=reported'))!.json() as
      { items: Array<{ id: string; status: string; reports: unknown[] }> };
    expect(page.items).toEqual([expect.objectContaining({ id: bottle.id, status: 'pending' })]);
    expect(page.items[0]!.reports).toHaveLength(3);
  });

  it('屏蔽作者后看不到对方的全部留言，可以在列表里解除屏蔽', async () => {
    const { env } = setup('post');
    const first = await post(env, '第一条');
    const second = await post(env, '第二条');
    expect((await call(env, readers[0], `/v1/message-bottles/${first.id}/block`, 'POST')).status).toBe(204);
    expect(await visibleTo(env, readers[0])).toEqual([]);
    expect(await visibleTo(env, readers[1])).toEqual([second.id, first.id]);
    const blocked = BlockedUsersSchema.parse(await (await call(env, readers[0], '/v1/blocked-users')).json());
    expect(blocked.users).toEqual([expect.objectContaining({ userId: author, username: '小林' })]);
    expect((await call(env, readers[0], `/v1/blocked-users/${author}`, 'DELETE')).status).toBe(204);
    expect(await visibleTo(env, readers[0])).toEqual([second.id, first.id]);
    await expect(call(env, author, `/v1/message-bottles/${first.id}/block`, 'POST')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('禁言后不能再发布，已有留言一并隐藏', async () => {
    const { env } = setup('post');
    await post(env);
    expect((await admin(env, `/v1/admin/users/${author}/ban`, 'POST'))!.status).toBe(200);
    expect(await visibleTo(env, readers[0])).toEqual([]);
    await expect(post(env, '新的留言')).rejects.toMatchObject({ code: 'MESSAGE_BOTTLE_BANNED' });
    expect((await admin(env, `/v1/admin/users/${author}/unban`, 'POST'))!.status).toBe(200);
    expect((await post(env, '新的留言')).status).toBe('visible');
  });

  it('审核后台需要口令；没有配置口令时整个后台不存在', async () => {
    const { env } = setup();
    await expect(admin(env, '/v1/admin/message-bottles', 'GET', 'wrong-token'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const page = await admin(env, '/v1/admin/moderation');
    expect(page!.headers.get('content-security-policy')).toContain("script-src 'nonce-");
    expect(await page!.text()).toContain('留言审核');
    const disabled = { ...env, ADMIN_TOKEN: '' } as ApiEnv;
    await expect(admin(disabled, '/v1/admin/moderation')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(admin(disabled, '/v1/admin/message-bottles')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('有留言等待审核时最多每半小时发一封提醒邮件', async () => {
    const { env } = setup('pre');
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    Object.assign(env, { MODERATION_NOTIFY_EMAIL: 'moderator@example.com', RESEND_API_KEY: 'resend-key', PASSWORD_RESET_FROM_EMAIL: 'no-reply@example.com' });
    await post(env, '第一条');
    await post(env, '第二条');
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { to: string[]; text: string };
    expect(body.to).toEqual(['moderator@example.com']);
    expect(body.text).toContain('/v1/admin/moderation');
  });
});

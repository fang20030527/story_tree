import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { CreatePracticeAcceptedSchema, DashboardDtoSchema, PracticeDtoSchema } from '@context-reader/contracts';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRemainingQuota as authQuota } from '../auth/database';
import type { ApiEnv, D1DatabaseBinding } from '../env';
import { handlePracticeCreateRoute } from '../practice/create';
import { handlePracticeReadRoute } from '../practice/read';
import { handleDashboardRoute } from '../read/dashboard';
import {
  commitQuota,
  getRemainingQuota,
  releaseQuota,
  reserveQuota,
  UNLIMITED_PRACTICES_REMAINING,
} from './service';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const instances: Miniflare[] = [];
const capability = { generationHandlerReady: true, scheduledRecoveryReady: true };

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup() {
  const instance = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'quota-test' },
  }));
  instances.push(instance);
  const db = await instance.getD1Database('DB');
  const directory = resolve('cloudflare/api/migrations');
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(directory, name), 'utf8')
      .split(/\r?\n/u).filter((line) => !/^\s*--/u.test(line)).join('\n');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  for (const id of [userId, otherUserId]) {
    await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
      .bind(id, 'registered', new Date().toISOString()).run();
  }
  const send = vi.fn(async () => {});
  const env = { DB: db, JOB_QUEUE: { send }, EVOLINK_API_KEY: 'fake-test-key' } as unknown as ApiEnv;
  return { db, env, send };
}

async function practice(db: D1DatabaseBinding, owner = userId): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO practice_sessions (id, user_id) VALUES (?, ?)').bind(id, owner).run();
  return id;
}

async function exhaust(db: D1DatabaseBinding, owner = userId): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    const id = await practice(db, owner);
    await reserveQuota(db, owner, id, 3);
    await commitQuota(db, id);
  }
}

async function grant(db: D1DatabaseBinding): Promise<void> {
  await db.prepare('INSERT INTO user_practice_access (user_id, unlimited_practices) VALUES (?, 1)')
    .bind(userId).run();
}

function createRequest(key: string, topicSet = false): Request {
  return new Request('https://blackholeenglish.com/v1/practices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      items: [
        { term: 'orbit', meaningZh: '轨道' },
        { term: 'signal', meaningZh: '信号' },
        { term: 'climate', meaningZh: '气候' },
        { term: 'energy', meaningZh: '能源' },
      ],
      ...(topicSet ? { format: 'topic_set' } : {}),
    }),
  });
}

describe('账号级无限练习额度', () => {
  it('普通账号用完三次后仍被拒绝，失败不会插入预留记录', async () => {
    const { db } = await setup();
    await exhaust(db);
    const fourth = await practice(db);
    expect(await getRemainingQuota(db, userId, 3)).toBe(0);
    await expect(reserveQuota(db, userId, fourth, 3)).rejects.toMatchObject({ code: 'FREE_LIMIT_REACHED' });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM usage_ledger WHERE kind = ?')
      .bind('reserve').first()).toEqual({ count: 3 });
  });

  it('豁免后可继续预留，重放和失败释放保持幂等，撤销后恢复正常额度校验', async () => {
    const { db } = await setup();
    await exhaust(db);
    await grant(db);
    const fourth = await practice(db);
    expect(await reserveQuota(db, userId, fourth, 3)).toEqual({
      reserved: true, remainingFreePractices: UNLIMITED_PRACTICES_REMAINING,
    });
    expect((await reserveQuota(db, userId, fourth, 3)).reserved).toBe(false);
    expect(await releaseQuota(db, fourth)).toBe('applied');
    expect(await releaseQuota(db, fourth)).toBe('unchanged');
    expect(await commitQuota(db, fourth)).toBe('unchanged');
    expect(await getRemainingQuota(db, userId, 3)).toBe(UNLIMITED_PRACTICES_REMAINING);
    await db.prepare('UPDATE user_practice_access SET unlimited_practices = 0 WHERE user_id = ?')
      .bind(userId).run();
    expect(await getRemainingQuota(db, userId, 3)).toBe(0);
  });

  it('豁免不允许读取或预留其他账号的练习，也不允许已删除账号使用', async () => {
    const { db } = await setup();
    await grant(db);
    const otherPractice = await practice(db, otherUserId);
    await expect(reserveQuota(db, userId, otherPractice, 3)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ownPractice = await practice(db);
    await db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), userId).run();
    await expect(reserveQuota(db, userId, ownPractice, 3)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await getRemainingQuota(db, userId, 3)).not.toBe(UNLIMITED_PRACTICES_REMAINING);
  });

  it('真实创建批次可连续生成超过三组，重放不重复扣账，其他账号仍受额度限制', async () => {
    const { db, env, send } = await setup();
    await exhaust(db);
    await exhaust(db, otherUserId);
    await grant(db);
    let firstPracticeId = '';
    for (let index = 0; index < 4; index += 1) {
      const response = await handlePracticeCreateRoute(createRequest(`unlimited-request-${index}`), env, userId, capability);
      expect(response?.status).toBe(202);
      const body = CreatePracticeAcceptedSchema.parse(await response!.json());
      expect(body.remainingFreePractices).toBe(UNLIMITED_PRACTICES_REMAINING);
      if (index === 0) firstPracticeId = body.practiceId;
    }
    const replay = await handlePracticeCreateRoute(createRequest('unlimited-request-0'), env, userId, capability);
    expect(CreatePracticeAcceptedSchema.parse(await replay!.json()).practiceId).toBe(firstPracticeId);
    expect(send).toHaveBeenCalledTimes(4);
    expect(await db.prepare('SELECT SUM(amount) AS total FROM usage_ledger WHERE user_id = ?')
      .bind(userId).first()).toEqual({ total: -7 });
    await expect(handlePracticeCreateRoute(createRequest('normal-request-exhausted'), env, otherUserId, capability))
      .rejects.toMatchObject({ code: 'FREE_LIMIT_REACHED' });
    expect(await getRemainingQuota(db, otherUserId, 3)).toBe(0);
  }, 30_000);

  it('四主题创建、详情、登录额度与 dashboard 都返回旧客户端兼容的无限标记', async () => {
    const { db, env, send } = await setup();
    await exhaust(db);
    await grant(db);
    const response = await handlePracticeCreateRoute(createRequest('unlimited-topic-set', true), env, userId, capability);
    const created = CreatePracticeAcceptedSchema.parse(await response!.json());
    expect(created.remainingFreePractices).toBe(UNLIMITED_PRACTICES_REMAINING);
    expect(send).toHaveBeenCalledTimes(4);
    const detail = await handlePracticeReadRoute(new Request(`https://blackholeenglish.com/v1/practices/${created.practiceId}?includeProgress=1`), env, userId);
    const parsed = PracticeDtoSchema.parse(await detail!.json());
    expect(parsed.remainingFreePractices).toBe(UNLIMITED_PRACTICES_REMAINING);
    expect(parsed.group?.articles).toHaveLength(4);
    const dashboard = await handleDashboardRoute(new Request('https://blackholeenglish.com/v1/dashboard'), env, userId);
    expect(DashboardDtoSchema.parse(await dashboard!.json()).remainingFreePractices).toBe(UNLIMITED_PRACTICES_REMAINING);
    expect(await authQuota(db, userId)).toBe(UNLIMITED_PRACTICES_REMAINING);
    expect(await db.prepare('SELECT SUM(amount) AS total FROM usage_ledger WHERE user_id = ?')
      .bind(userId).first()).toEqual({ total: -4 });
  }, 30_000);
});

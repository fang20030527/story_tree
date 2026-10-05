import { CreatePracticeAcceptedSchema, PracticeDtoSchema } from '@context-reader/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashInstallationToken } from '../auth/token';
import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import worker from '../index';
import { createMiniflareD1, disposeMiniflareD1 } from '../test-support/miniflare-d1';
import { handlePracticeCreateRoute } from './create';
import { handlePracticeReadRoute } from './read';
import { handlePracticeRetryFailedRoute } from './retry-failed';

vi.mock('../cpu/object', () => ({ CpuBoundary: class {} }));

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const capability = { generationHandlerReady: true, scheduledRecoveryReady: true };

afterEach(disposeMiniflareD1);

async function setup() {
  const db = await createMiniflareD1('retry-failed-test');
  for (const id of [userId, otherUserId]) {
    await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
      .bind(id, 'registered', new Date().toISOString()).run();
  }
  const send = vi.fn(async (_message: { jobId: string }) => {});
  const env = { DB: db, JOB_QUEUE: { send }, EVOLINK_API_KEY: 'fake-test-key' } as unknown as ApiEnv;
  return { db, env, send };
}

async function createGroup(env: ApiEnv) {
  const response = await handlePracticeCreateRoute(new Request('https://blackholeenglish.com/v1/practices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'create_topic_group_0001' },
    body: JSON.stringify({
      format: 'topic_set',
      items: [
        { term: 'orbit', meaningZh: '轨道' },
        { term: 'signal', meaningZh: '信号' },
        { term: 'climate', meaningZh: '气候' },
        { term: 'energy', meaningZh: '能源' },
      ],
    }),
  }), env, userId, capability);
  const { practiceId } = CreatePracticeAcceptedSchema.parse(await response!.json());
  const members = await env.DB.prepare(`
    SELECT id FROM practice_sessions WHERE topic_group_id = ? ORDER BY topic_position
  `).bind(practiceId).all<{ id: string }>();
  return { groupId: practiceId, ids: members.results.map((member) => member.id) };
}

/** Simulate the end of a generation job: the article is readable, or it failed with a code. */
async function settle(db: D1DatabaseBinding, practiceId: string, failureCode: string | null) {
  await db.prepare(`
    UPDATE practice_sessions SET status = ?, failure_code = ?, failure_message_public = ?,
      generation_progress = 40
    WHERE id = ?
  `).bind(failureCode ? 'failed' : 'ready', failureCode, failureCode ? '练习暂时无法生成，请稍后重试' : null,
    practiceId).run();
  await db.prepare(`
    UPDATE jobs SET status = ?, attempt_count = 3, last_error_code = ?, finished_at = ?
    WHERE kind = 'practice_generation' AND resource_id = ?
  `).bind(failureCode ? 'failed' : 'succeeded', failureCode, new Date().toISOString(), practiceId).run();
}

function retryRequest(groupId: string, key: string): Request {
  return new Request(`https://blackholeenglish.com/v1/practices/${groupId}/retry-failed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: '{}',
  });
}

async function readGroup(env: ApiEnv, practiceId: string) {
  const response = await handlePracticeReadRoute(
    new Request(`https://blackholeenglish.com/v1/practices/${practiceId}?includeProgress=1`), env, userId);
  return PracticeDtoSchema.parse(await response!.json()).group!;
}

describe('POST /v1/practices/:id/retry-failed', () => {
  it('重新排队可重试的失败短文，不改动已就绪或不可重试的短文，也不额外扣次数', async () => {
    const { db, env, send } = await setup();
    const { groupId, ids } = await createGroup(env);
    const [root, ready, timedOut, rejected] = ids as [string, string, string, string];
    await settle(db, root, 'AI_UNAVAILABLE');
    await settle(db, ready, null);
    await settle(db, timedOut, 'GENERATION_DEADLINE_EXCEEDED');
    await settle(db, rejected, 'AI_CONTENT_REJECTED');
    const ledgerBefore = await db.prepare('SELECT COUNT(*) AS count FROM usage_ledger').first<{ count: number }>();
    expect((await readGroup(env, root)).canRetryFailed).toBe(true);
    send.mockClear();

    const response = await handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0001'), env, userId);
    expect(response!.status).toBe(200);
    expect(await response!.json()).toEqual({ groupId });

    const sessions = await db.prepare(`
      SELECT id, status, generation_progress AS progress, failure_code AS failureCode,
        failure_message_public AS failureMessage
      FROM practice_sessions WHERE topic_group_id = ?
    `).bind(groupId).all<{ id: string; status: string; progress: number; failureCode: string | null; failureMessage: string | null }>();
    const byId = new Map(sessions.results.map((row) => [row.id, row]));
    for (const id of [root, timedOut]) {
      expect(byId.get(id)).toMatchObject({ status: 'queued', progress: 0, failureCode: null, failureMessage: null });
    }
    expect(byId.get(ready)!.status).toBe('ready');
    expect(byId.get(rejected)).toMatchObject({ status: 'failed', failureCode: 'AI_CONTENT_REJECTED' });

    const jobs = await db.prepare(`
      SELECT id, resource_id AS resourceId, status, max_attempts AS maxAttempts, last_error_code AS lastError,
        finished_at AS finishedAt, deadline_at AS deadlineAt
      FROM jobs WHERE kind = 'practice_generation' AND resource_id IN (?, ?)
    `).bind(root, timedOut).all<{ id: string; resourceId: string; status: string; maxAttempts: number; lastError: string | null; finishedAt: string | null; deadlineAt: string }>();
    expect(jobs.results).toHaveLength(2);
    for (const job of jobs.results) {
      expect(job).toMatchObject({ status: 'queued', maxAttempts: 6, lastError: null, finishedAt: null });
      expect(Date.parse(job.deadlineAt)).toBeGreaterThan(Date.now() + 60_000);
    }
    expect(send.mock.calls.map(([message]) => message.jobId).sort())
      .toEqual(jobs.results.map((job) => job.id).sort());
    const ledgerAfter = await db.prepare('SELECT COUNT(*) AS count FROM usage_ledger').first<{ count: number }>();
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect((await readGroup(env, rejected)).canRetryFailed).toBe(false);

    // The same request again answers the same way and queues nothing new.
    send.mockClear();
    const replay = await handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0001'), env, userId);
    expect(await replay!.json()).toEqual({ groupId });
    expect(send).not.toHaveBeenCalled();
  });

  it('每篇短文只能补一次；没有已就绪短文时要求重新创建', async () => {
    const { db, env } = await setup();
    const { groupId, ids } = await createGroup(env);
    const [root, ready, ...rest] = ids as [string, string, string, string];
    await settle(db, root, 'AI_INVALID_OUTPUT');
    await settle(db, ready, null);
    for (const id of rest) await settle(db, id, 'AI_CONTENT_REJECTED');
    await handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0001'), env, userId);

    // The refilled slot fails again: it was already given its second chance.
    await db.prepare(`UPDATE practice_sessions SET status = 'failed', failure_code = 'AI_UNAVAILABLE' WHERE id = ?`)
      .bind(root).run();
    await db.prepare(`UPDATE jobs SET status = 'failed' WHERE resource_id = ?`).bind(root).run();
    await expect(handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0002'), env, userId))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '这些短文已达到重试上限' });

    await db.prepare(`UPDATE practice_sessions SET status = 'failed', failure_code = 'AI_UNAVAILABLE' WHERE id = ?`)
      .bind(ready).run();
    await expect(handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0003'), env, userId))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', message: '请重新创建一组短文' });
  });

  it('拒绝其他账号的练习、复用于其他请求的幂等键和非主题练习编号', async () => {
    const { db, env } = await setup();
    const { groupId, ids } = await createGroup(env);
    await settle(db, ids[0]!, 'AI_UNAVAILABLE');
    await settle(db, ids[1]!, null);

    await expect(handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0001'), env, otherUserId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(handlePracticeRetryFailedRoute(retryRequest(ids[1]!, 'retry_failed_key_0001'), env, userId))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0001'), env, userId);
    const otherGroupId = crypto.randomUUID();
    await expect(handlePracticeRetryFailedRoute(retryRequest(otherGroupId, 'retry_failed_key_0001'), env, userId))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(handlePracticeRetryFailedRoute(new Request(
      `https://blackholeenglish.com/v1/practices/${groupId}/retry-failed`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    ), env, userId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('读取后状态被并发修改时整批回滚，不留下半份重试', async () => {
    const { db, env } = await setup();
    const { groupId, ids } = await createGroup(env);
    const [root, ready, other] = ids as [string, string, string, string];
    await settle(db, root, 'AI_UNAVAILABLE');
    await settle(db, ready, null);
    await settle(db, other, 'AI_UNAVAILABLE');
    // Another worker re-queues one slot between the reads and the batch.
    const racing: D1DatabaseBinding = {
      prepare: (sql: string) => db.prepare(sql),
      batch: async (statements: D1StatementBinding[]) => {
        await db.prepare(`UPDATE jobs SET status = 'queued' WHERE resource_id = ?`).bind(other).run();
        return db.batch(statements);
      },
    };
    await expect(handlePracticeRetryFailedRoute(retryRequest(groupId, 'retry_failed_key_0001'),
      { ...env, DB: racing }, userId)).rejects.toMatchObject({ code: 'STATE_CONFLICT', retryable: true });
    const rootRow = await db.prepare('SELECT status FROM practice_sessions WHERE id = ?').bind(root)
      .first<{ status: string }>();
    expect(rootRow!.status).toBe('failed');
    const records = await db.prepare(`SELECT COUNT(*) AS count FROM idempotency_records WHERE operation = 'retry_failed_topics'`)
      .first<{ count: number }>();
    expect(records!.count).toBe(0);
  });
});

describe('Worker 分发', () => {
  it('重试接口经由入口分发；未知路由返回不可重试的 404', async () => {
    const { db, env } = await setup();
    const { groupId, ids } = await createGroup(env);
    await settle(db, ids[0]!, 'AI_UNAVAILABLE');
    await settle(db, ids[1]!, null);
    const configured = Object.assign(env, {
      API_STAGE_OPEN: 'true', CPU_BOUNDARY: {}, IMPORT_BUCKET: {}, IMAGE_SERVICE: {}, AI: {}, IMAGES: {},
      RESEND_API_KEY: 'test-key', PASSWORD_RESET_FROM_EMAIL: 'test@example.com',
    });
    const token = await installationFor(db, userId);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const retried = await worker.fetch(new Request(`https://example.com/v1/practices/${groupId}/retry-failed`, {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'retry_failed_key_0001' }, body: '{}',
    }), configured);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ groupId });

    const missing = await worker.fetch(new Request('https://example.com/v1/no-such-route', { headers }), configured);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND', retryable: false } });
  });
});

/** The user already exists, so only an installation token is added for the worker's Bearer check. */
async function installationFor(db: D1DatabaseBinding, owner: string): Promise<string> {
  const token = owner.replaceAll('-', '').repeat(2).slice(0, 64);
  await db.prepare('INSERT INTO installations (id, user_id, token_hash) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), owner, await hashInstallationToken(token)).run();
  return token;
}

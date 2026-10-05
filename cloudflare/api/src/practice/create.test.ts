import { CreatePracticeAcceptedSchema } from '@context-reader/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnv } from '../env';
import { countingBindings, createMiniflareD1, disposeMiniflareD1 } from '../test-support/miniflare-d1';
import { handleVocabularyCreateRoute } from '../vocabulary/create';
import { handlePracticeCreateRoute } from './create';

const userId = '11111111-1111-4111-8111-111111111111';
const capability = { generationHandlerReady: true, scheduledRecoveryReady: true };

afterEach(disposeMiniflareD1);

async function setup(words: number) {
  const db = await createMiniflareD1('practice-create-test');
  await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .bind(userId, 'registered', new Date().toISOString()).run();
  const send = vi.fn(async () => {});
  const env = { DB: db, JOB_QUEUE: { send }, EVOLINK_API_KEY: 'fake-test-key' } as unknown as ApiEnv;
  for (let index = 0; index < words; index += 1) {
    const response = await handleVocabularyCreateRoute(new Request('https://blackholeenglish.com/v1/vocabulary-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `vocabulary_item_key_${String(index).padStart(4, '0')}` },
      body: JSON.stringify({ term: `term${String.fromCharCode(97 + (index % 26))}${index}`, meaningZh: `含义${index}` }),
    }), env, userId);
    expect(response!.status).toBe(201);
  }
  return { db, env };
}

function createRequest(body: unknown): Request {
  return new Request('https://blackholeenglish.com/v1/practices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'create_practice_key_0001' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/practices', () => {
  it('从词库创建长篇练习时拆分目标写入，每条语句不超过 D1 的 100 个绑定参数', async () => {
    const { db, env } = await setup(24);
    const counting = countingBindings(db);

    const response = await handlePracticeCreateRoute(createRequest({ source: 'vocabulary', targetCount: 24 }),
      { ...env, DB: counting.db }, userId, capability);

    expect(response!.status).toBe(202);
    const { practiceId } = CreatePracticeAcceptedSchema.parse(await response!.json());
    expect(Math.max(...counting.counts)).toBeLessThanOrEqual(100);
    const targets = await db.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT position) AS positions, MIN(position) AS first, MAX(position) AS last
      FROM practice_targets WHERE practice_session_id = ?
    `).bind(practiceId).first<{ count: number; positions: number; first: number; last: number }>();
    expect(targets).toEqual({ count: 24, positions: 24, first: 0, last: 23 });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnv } from '../env';
import { closeTestDatabases, createTestD1 } from '../test-support/sqlite-d1';
import {
  aiUsageDay,
  assertAiAvailable,
  assertTranslationAllowed,
  consumeAiCall,
  USER_DAILY_TRANSLATION_LIMIT,
} from './budget';
import { evolinkProvider } from './provider';

const userId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  closeTestDatabases();
  vi.unstubAllGlobals();
});

function setup(limit: string) {
  const { db, sqlite, env } = createTestD1();
  return {
    db, sqlite,
    env: { ...env, AI_DAILY_CALL_LIMIT: limit, EVOLINK_API_KEY: 'test-key' } as ApiEnv,
    calls: () => (sqlite.prepare('SELECT calls FROM ai_usage_daily WHERE day = ?')
      .get(aiUsageDay()) as { calls: number } | undefined)?.calls ?? 0,
  };
}

describe('全站 AI 用量上限', () => {
  it('按北京时间日期计数', () => {
    expect(aiUsageDay(new Date('2026-10-05T15:59:59.000Z'))).toBe('2026-10-05');
    expect(aiUsageDay(new Date('2026-10-05T16:00:00.000Z'))).toBe('2026-10-06');
  });

  it('达到上限后拒绝新的 AI 任务，已开始的任务还能用完 25% 的余量', async () => {
    const { env, calls } = setup('4');
    await assertAiAvailable(env);
    for (let index = 0; index < 4; index += 1) await consumeAiCall(env);
    await expect(assertAiAvailable(env)).rejects.toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED', retryable: false });
    await consumeAiCall(env);
    await expect(consumeAiCall(env)).rejects.toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED' });
    expect(calls()).toBe(5);
  });

  it('每次真实的 EvoLink 调用都先计数，超出余量时不再发出请求', async () => {
    const { env, calls } = setup('1');
    const fetch = vi.fn(async () => Response.json({
      model: 'gpt-6-luna', choices: [{ message: { role: 'assistant', content: '你好' } }],
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(evolinkProvider(env).translate('Hello', new AbortController().signal)).resolves.toBe('你好');
    expect(calls()).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The headroom of a limit of one is two calls in total.
    await evolinkProvider(env).translate('Hello', new AbortController().signal);
    await expect(evolinkProvider(env).translate('Hello', new AbortController().signal))
      .rejects.toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('每个账号的即时翻译每天有单独上限', async () => {
    const { env, sqlite } = setup('100');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(`ai-translation-day:${userId}`),
    )), (byte) => byte.toString(16).padStart(2, '0')).join('');
    sqlite.prepare('INSERT INTO api_rate_limits (key_hash, window_started_at, request_count, expires_at) VALUES (?, ?, ?, ?)')
      .run(digest, new Date().toISOString(), USER_DAILY_TRANSLATION_LIMIT - 1, new Date(Date.now() + 3_600_000).toISOString());
    await assertTranslationAllowed(env, userId);
    await expect(assertTranslationAllowed(env, userId))
      .rejects.toMatchObject({ code: 'AI_DAILY_LIMIT_REACHED', message: '今天的翻译次数已达上限，请明天再试' });
  });
});

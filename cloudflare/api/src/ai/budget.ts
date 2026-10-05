import { AppError } from '../../../../server/src/core/errors';
import { enforceRateLimit, RateLimitError } from '../core/rate-limit';
import type { ApiEnv } from '../env';

/** Instant word and sentence translations one account may request in 24 hours. */
export const USER_DAILY_TRANSLATION_LIMIT = 500;

/**
 * A site-wide daily cap on paid AI calls (EvoLink text, vision and audio). Every call is counted
 * before it is sent. New AI work (a practice, a translation, an image import, a speaking review)
 * is refused once the day's count reaches the limit; calls already admitted may run on into a
 * 25% headroom, so a practice that started generating can still finish its articles.
 */
export const DEFAULT_AI_DAILY_CALL_LIMIT = 2_000;
const HEADROOM = 1.25;
const BEIJING_OFFSET_MS = 8 * 3_600_000;

export function aiDailyCallLimit(env: ApiEnv): number {
  const raw = env.AI_DAILY_CALL_LIMIT;
  if (raw === undefined || raw === '') return DEFAULT_AI_DAILY_CALL_LIMIT;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new AppError('INTERNAL_ERROR', 'AI 用量配置无效', 500, true);
  }
  return limit;
}

/** The Beijing calendar day, matching the free practice reset. */
export function aiUsageDay(now = new Date()): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function exhausted(): AppError {
  return new AppError('AI_DAILY_LIMIT_REACHED', '今天的 AI 服务用量已达上限，请明天再试', 429);
}

/** Refuses new AI work once today's calls reached the limit. Reads only. */
export async function assertAiAvailable(env: ApiEnv, now = new Date()): Promise<void> {
  const limit = aiDailyCallLimit(env);
  const row = await env.DB.prepare('SELECT calls FROM ai_usage_daily WHERE day = ?')
    .bind(aiUsageDay(now)).first<{ calls: number }>();
  if ((row?.calls ?? 0) >= limit) throw exhausted();
}

/**
 * Instant translations are the one AI feature a single account can call at reading speed, so
 * each account gets its own 24-hour allowance and cannot use up the site-wide cap alone.
 */
export async function assertTranslationAllowed(env: ApiEnv, userId: string): Promise<void> {
  try {
    await enforceRateLimit(env, 'ai-translation-day', userId, USER_DAILY_TRANSLATION_LIMIT, 86_400_000);
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw new AppError('AI_DAILY_LIMIT_REACHED', '今天的翻译次数已达上限，请明天再试', 429);
    }
    throw error;
  }
  await assertAiAvailable(env);
}

/** Counts one upstream call, refusing it beyond the headroom. One atomic statement. */
export async function consumeAiCall(env: ApiEnv, now = new Date()): Promise<void> {
  const hardLimit = Math.ceil(aiDailyCallLimit(env) * HEADROOM);
  const counted = await env.DB.prepare(`
    INSERT INTO ai_usage_daily (day, calls) VALUES (?, 1)
    ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?
    RETURNING calls
  `).bind(aiUsageDay(now), hardLimit).first<{ calls: number }>();
  if (!counted) throw exhausted();
}

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', '请求过于频繁，请稍后重试', 429, true);
  }
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function enforceRateLimit(
  env: ApiEnv,
  category: string,
  subject: string,
  maximum: number,
  intervalMs = 60_000,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + intervalMs).toISOString();
  const keyHash = await digest(`${category}:${subject}`);
  const result = await env.DB.prepare(`
    INSERT INTO api_rate_limits(key_hash, window_started_at, request_count, expires_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      window_started_at = CASE WHEN expires_at <= excluded.window_started_at
        THEN excluded.window_started_at ELSE window_started_at END,
      request_count = CASE WHEN expires_at <= excluded.window_started_at
        THEN 1 ELSE request_count + 1 END,
      expires_at = CASE WHEN expires_at <= excluded.window_started_at
        THEN excluded.expires_at ELSE expires_at END
    RETURNING request_count, expires_at
  `).bind(keyHash, now.toISOString(), expiresAt)
    .first<{ request_count: number; expires_at: string }>();
  if (!result) throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时无法访问', 503, true);
  if (result.request_count > maximum) {
    const remainingMs = Date.parse(result.expires_at) - Date.now();
    throw new RateLimitError(Math.max(1, Math.ceil(remainingMs / 1_000)));
  }
}

export async function enforceRequestLimits(request: Request, env: ApiEnv): Promise<void> {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/health/live' || pathname === '/health/ready') return;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  await enforceRateLimit(env, 'global-ip', ip, 600);

  if (pathname === '/v1/auth/password-reset/request' ||
      pathname === '/v1/auth/password-reset/confirm') {
    await enforceRateLimit(env, 'password-reset-ip', ip, 120);
    return;
  }
  if (request.method === 'POST' && pathname === '/v1/sentence-translations') {
    await enforceRateLimit(env, 'sentence-token', request.headers.get('authorization') ?? `missing:${ip}`, 60);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    await enforceRateLimit(env, 'sensitive-token', request.headers.get('authorization') ?? `missing:${ip}`, 30);
  }
}

export async function deleteExpiredRateLimits(env: ApiEnv, now = new Date()): Promise<void> {
  await env.DB.prepare('DELETE FROM api_rate_limits WHERE expires_at < ?')
    .bind(now.toISOString()).run();
}

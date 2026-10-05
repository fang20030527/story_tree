import { DeleteAccountRequestSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { verifyEmailPasswordOnCpuBoundary } from '../cpu/client';
import { readJsonBody } from '../core/http';
import { enforceRateLimit } from '../core/rate-limit';
import type { ApiEnv } from '../env';

const PATH = '/v1/account/delete';
const ATTEMPTS_PER_TEN_MINUTES = 10;

/**
 * Deletes the account and everything it owns (App Store 5.1.1(v)). Every table that belongs to
 * a user references users(id) ON DELETE CASCADE, so one DELETE removes vocabulary, practices,
 * answers, imports, translations, speaking files and states, message bottles, reports, blocks,
 * the email or WeChat identity and every installation token. In the same transaction the
 * account's private speaking recordings and files are queued for the minute sweep, which removes
 * them from R2, and queued AI jobs for its resources are dropped. Quota usage events are not
 * tied to the account, so deleting it and signing up again does not reset the device's day.
 */
export async function handleAccountDeleteRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PATH) return null;
  if (request.method !== 'POST') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
  const parsed = DeleteAccountRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
  await enforceRateLimit(env, 'account-delete', userId, ATTEMPTS_PER_TEN_MINUTES, 600_000);

  const email = await env.DB.prepare('SELECT password_hash AS passwordHash FROM email_accounts WHERE user_id = ? LIMIT 1')
    .bind(userId).first<{ passwordHash: string }>();
  if (email) {
    const password = parsed.data.password;
    if (!password) throw new AppError('ACCOUNT_PASSWORD_REQUIRED', '请输入登录密码以确认注销', 400);
    if (!(await verifyEmailPasswordOnCpuBoundary(env, password, email.passwordHash))) {
      throw new AppError('EMAIL_AUTH_FAILED', '密码错误，账号没有注销', 401);
    }
  }

  const importObjects = (await env.DB.prepare(`
    SELECT asset.object_key AS objectKey FROM import_assets AS asset
    JOIN article_imports AS source ON source.id = asset.article_import_id
    WHERE source.user_id = ?
  `).bind(userId).all<{ objectKey: string }>()).results.map((row) => row.objectKey);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO speaking_storage_cleanup (storage_key, created_at)
      SELECT storage_key, ? FROM speaking_assets WHERE user_id = ?
      ON CONFLICT(storage_key) DO NOTHING
    `).bind(now, userId),
    env.DB.prepare(`
      DELETE FROM jobs WHERE
        (kind = 'practice_generation' AND resource_id IN (SELECT id FROM practice_sessions WHERE user_id = ?1))
        OR (kind = 'translation' AND resource_id IN (
          SELECT translation.id FROM translations AS translation
          JOIN practice_sessions AS practice ON practice.id = translation.practice_session_id
          WHERE practice.user_id = ?1))
        OR (kind = 'article_import' AND resource_id IN (SELECT id FROM article_imports WHERE user_id = ?1))
        OR (kind = 'article_translation' AND resource_id IN (
          SELECT translation.id FROM article_translations AS translation
          JOIN imported_articles AS article ON article.id = translation.article_id
          WHERE article.user_id = ?1))
    `).bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
  // Temporary import uploads also expire with the bucket's eight-day rule; this is a head start.
  if (importObjects.length > 0) {
    await env.IMPORT_BUCKET.delete(importObjects).catch(() => {
      console.error({ errorType: 'AccountImportCleanupFailed' });
    });
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

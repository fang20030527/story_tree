import type { ApiEnv, D1DatabaseBinding } from '../env';
import { AppError } from '../../../../server/src/core/errors';
import { hashInstallationToken, parseBearerToken } from './token';

export interface AuthContext {
  userId: string;
  installationId: string;
}

export interface AuthUser extends AuthContext {
  created: boolean;
}

interface InstallationRow {
  installationId: string;
  userId: string;
  revokedAt: string | null;
  userDeletedAt: string | null;
}

const installationSelect = `
  SELECT i.id AS installationId, i.user_id AS userId,
         i.revoked_at AS revokedAt, u.deleted_at AS userDeletedAt
  FROM installations AS i
  JOIN users AS u ON u.id = i.user_id
  WHERE i.token_hash = ?
  LIMIT 1
`;

export async function requireAuth(request: Request, env: ApiEnv): Promise<AuthContext> {
  const token = parseBearerToken(request.headers.get('authorization'));
  const tokenHash = await hashInstallationToken(token);
  const now = new Date().toISOString();

  // The conditional write prevents a token revoked during this request from
  // being accepted after an earlier read.
  const active = await env.DB.prepare(`
    UPDATE installations
    SET last_seen_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = installations.user_id AND users.deleted_at IS NULL
      )
    RETURNING id AS installationId, user_id AS userId
  `).bind(now, tokenHash).first<AuthContext>();
  if (active) return active;

  const existing = await env.DB.prepare(installationSelect)
    .bind(tokenHash).first<InstallationRow>();
  if (existing) throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
}

export async function registerAnonymous(
  request: Request,
  env: ApiEnv,
  ageConfirmed14Plus: boolean,
): Promise<AuthUser> {
  const token = parseBearerToken(request.headers.get('authorization'));
  const tokenHash = await hashInstallationToken(token);
  const existing = await env.DB.prepare(installationSelect)
    .bind(tokenHash).first<InstallationRow>();
  if (existing) {
    if (existing.revokedAt || existing.userDeletedAt) {
      throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
    }
    const current = await requireAuth(request, env);
    return { ...current, created: false };
  }
  if (!ageConfirmed14Plus) {
    throw new AppError('AGE_CONFIRMATION_REQUIRED', '需要确认已满 14 周岁', 403);
  }

  const userId = crypto.randomUUID();
  const installationId = crypto.randomUUID();
  const now = new Date().toISOString();

  // D1 batch is one transaction. If another request claimed this token first,
  // neither statement inserts a row, so no orphan guest is created.
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, kind, age_confirmed_at, created_at)
      SELECT ?, 'guest', ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM installations WHERE token_hash = ?)
    `).bind(userId, now, now, tokenHash),
    env.DB.prepare(`
      INSERT INTO installations (id, user_id, token_hash, created_at, last_seen_at)
      SELECT ?, id, ?, ?, ? FROM users WHERE id = ?
    `).bind(installationId, tokenHash, now, now, userId),
  ]);

  const actual = await requireAuth(request, env);
  return { ...actual, created: actual.installationId === installationId };
}

export async function getRemainingQuota(
  db: D1DatabaseBinding,
  userId: string,
  freeLimit = 3,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM usage_ledger WHERE user_id = ?
  `).bind(userId).first<{ total: number }>();
  return Math.min(freeLimit, Math.max(0, freeLimit + (row?.total ?? 0)));
}

const GUEST_CONTENT_CHECK = `
  NOT EXISTS (SELECT 1 FROM vocabulary_items WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM practice_sessions WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM imported_articles WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM article_imports WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM computer_upload_sessions WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM assistance_events WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM answer_attempts WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM idempotency_records WHERE user_id = ?)
  AND NOT EXISTS (SELECT 1 FROM usage_ledger WHERE user_id = ?)
`;

export async function bindInstallationToUser(
  db: D1DatabaseBinding,
  current: AuthContext,
  targetUserId: string,
  guard?:
    | { kind: 'email'; accountId: string; passwordHash: string }
    | { kind: 'wechat'; identityId: string },
): Promise<void> {
  const now = new Date().toISOString();
  const guardClause = guard?.kind === 'email'
    ? `AND EXISTS (
         SELECT 1 FROM email_accounts
         WHERE id = ? AND user_id = ? AND password_hash = ?
       )`
    : guard?.kind === 'wechat'
      ? `AND EXISTS (
           SELECT 1 FROM auth_identities
           WHERE id = ? AND user_id = ?
         )`
      : '';
  const guardValues = guard?.kind === 'email'
    ? [guard.accountId, targetUserId, guard.passwordHash]
    : guard?.kind === 'wechat'
      ? [guard.identityId, targetUserId]
      : [];
  const bound = await db.prepare(`
    UPDATE installations
    SET user_id = ?, last_seen_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)
      AND (
        ? = ? OR (
          EXISTS (
            SELECT 1 FROM users
            WHERE id = ? AND kind = 'guest' AND deleted_at IS NULL
          )
          AND ${GUEST_CONTENT_CHECK}
        )
      )
      ${guardClause}
    RETURNING id
  `).bind(
    targetUserId, now, current.installationId, current.userId,
    targetUserId, targetUserId, current.userId, current.userId,
    ...Array(9).fill(current.userId),
    ...guardValues,
  ).first<{ id: string }>();
  if (bound) return;

  const installation = await db.prepare(`
    SELECT i.user_id AS userId, i.revoked_at AS revokedAt,
           u.deleted_at AS userDeletedAt
    FROM installations AS i
    JOIN users AS u ON u.id = i.user_id
    WHERE i.id = ?
  `).bind(current.installationId).first<{
    userId: string;
    revokedAt: string | null;
    userDeletedAt: string | null;
  }>();
  if (!installation || installation.revokedAt || installation.userDeletedAt
    || installation.userId !== current.userId) {
    throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  }
  if (guard?.kind === 'email') {
    const latest = await db.prepare(`
      SELECT password_hash AS passwordHash FROM email_accounts
      WHERE id = ? AND user_id = ?
    `).bind(guard.accountId, targetUserId).first<{ passwordHash: string }>();
    if (!latest || latest.passwordHash !== guard.passwordHash) {
      throw new AppError('EMAIL_AUTH_FAILED', '邮箱或密码错误', 401);
    }
  }
  if (guard?.kind === 'wechat') {
    const latest = await db.prepare(`
      SELECT id FROM auth_identities WHERE id = ? AND user_id = ?
    `).bind(guard.identityId, targetUserId).first<{ id: string }>();
    if (!latest) throw new AppError('WECHAT_AUTH_FAILED', '微信授权失败', 401);
  }
  throw new AppError('AUTH_ACCOUNT_CONFLICT', '当前设备已有数据，请先完成账号合并', 409);
}

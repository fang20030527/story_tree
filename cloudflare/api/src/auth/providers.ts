import type { ApiEnv } from '../env';
import { AppError } from '../../../../server/src/core/errors';
import { createWechatClient } from '../../../../server/src/modules/auth/wechat-client';
import {
  hashEmailPasswordOnCpuBoundary,
  verifyEmailPasswordOnCpuBoundary,
} from '../cpu/client';
import type { AuthContext, AuthUser } from './database';
import { bindInstallationToUser } from './database';

interface EmailAccountRow {
  id: string;
  userId: string;
  passwordHash: string;
  userDeletedAt: string | null;
}

async function findEmailAccount(env: ApiEnv, email: string): Promise<EmailAccountRow | null> {
  return env.DB.prepare(`
    SELECT e.id, e.user_id AS userId, e.password_hash AS passwordHash,
           u.deleted_at AS userDeletedAt
    FROM email_accounts AS e
    JOIN users AS u ON u.id = e.user_id
    WHERE e.email = ?
    LIMIT 1
  `).bind(email).first<EmailAccountRow>();
}

function emailAuthFailed(): AppError {
  return new AppError('EMAIL_AUTH_FAILED', '邮箱或密码错误', 401);
}

export async function loginWithEmail(
  env: ApiEnv,
  current: AuthContext,
  email: string,
  password: string,
): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();
  let account = await findEmailAccount(env, normalizedEmail);

  if (!account) {
    const passwordHash = await hashEmailPasswordOnCpuBoundary(env, password);
    const accountId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO email_accounts
          (id, user_id, email, password_hash, created_at, last_login_at)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM installations
          WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        )
          AND EXISTS (
            SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL
          )
      `).bind(
        accountId, current.userId, normalizedEmail, passwordHash, now, now,
        current.installationId, current.userId, current.userId,
      ),
      env.DB.prepare(`
        UPDATE users SET kind = 'registered'
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM email_accounts
          WHERE id = ? AND user_id = ?
        )
      `).bind(current.userId, accountId, current.userId),
    ]);
    account = await findEmailAccount(env, normalizedEmail);
    if (!account) throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
    if (account.id === accountId) {
      return {
        userId: current.userId,
        installationId: current.installationId,
        created: true,
      };
    }
  }

  if (account.userDeletedAt ||
      !(await verifyEmailPasswordOnCpuBoundary(env, password, account.passwordHash))) {
    throw emailAuthFailed();
  }
  await bindInstallationToUser(env.DB, current, account.userId, {
    kind: 'email',
    accountId: account.id,
    passwordHash: account.passwordHash,
  });
  await env.DB.prepare(`
    UPDATE email_accounts SET last_login_at = ?
    WHERE id = ? AND password_hash = ?
  `).bind(new Date().toISOString(), account.id, account.passwordHash).run();
  return {
    userId: account.userId,
    installationId: current.installationId,
    created: false,
  };
}

interface WechatIdentityRow {
  id: string;
  userId: string;
  unionid: string | null;
  userDeletedAt: string | null;
}

async function findWechatIdentity(
  env: ApiEnv,
  subject: string,
  openid: string,
): Promise<WechatIdentityRow | null> {
  const bySubject = await env.DB.prepare(`
    SELECT a.id, a.user_id AS userId, a.unionid,
           u.deleted_at AS userDeletedAt
    FROM auth_identities AS a
    JOIN users AS u ON u.id = a.user_id
    WHERE a.provider = 'wechat' AND a.subject = ?
    LIMIT 1
  `).bind(subject).first<WechatIdentityRow>();
  if (bySubject) return bySubject;
  return env.DB.prepare(`
    SELECT a.id, a.user_id AS userId, a.unionid,
           u.deleted_at AS userDeletedAt
    FROM auth_identities AS a
    JOIN users AS u ON u.id = a.user_id
    WHERE a.provider = 'wechat' AND a.openid = ?
    LIMIT 1
  `).bind(openid).first<WechatIdentityRow>();
}

export async function loginWithWechat(
  env: ApiEnv,
  current: AuthContext,
  code: string,
): Promise<AuthUser> {
  const client = createWechatClient({
    appId: env.WECHAT_APP_ID ?? '',
    appSecret: env.WECHAT_APP_SECRET ?? '',
    baseUrl: 'https://api.weixin.qq.com',
    timeoutMs: 10_000,
  });
  const providerIdentity = await client.exchangeCode(code);
  const subject = providerIdentity.unionid ?? providerIdentity.openid;
  let identity = await findWechatIdentity(env, subject, providerIdentity.openid);

  if (!identity) {
    const identityId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO auth_identities
          (id, user_id, provider, subject, openid, unionid, created_at, last_login_at)
        SELECT ?, ?, 'wechat', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM installations
          WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        )
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM auth_identities
            WHERE provider = 'wechat' AND openid = ?
          )
      `).bind(
        identityId, current.userId, subject, providerIdentity.openid,
        providerIdentity.unionid ?? null, now, now,
        current.installationId, current.userId, current.userId,
        providerIdentity.openid,
      ),
      env.DB.prepare(`
        UPDATE users SET kind = 'registered'
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM auth_identities WHERE id = ? AND user_id = ?
        )
      `).bind(current.userId, identityId, current.userId),
    ]);
    identity = await findWechatIdentity(env, subject, providerIdentity.openid);
    if (!identity) throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
    if (identity.id === identityId) {
      return {
        userId: current.userId,
        installationId: current.installationId,
        created: true,
      };
    }
  }

  if (identity.userDeletedAt) {
    throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  }
  // Prefer the unionid whenever it becomes available. A concurrent bind may
  // claim the same subject, so the canonical row is loaded again afterward.
  await env.DB.prepare(`
    UPDATE OR IGNORE auth_identities
    SET subject = ?, openid = ?, unionid = COALESCE(?, unionid),
        last_login_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(
    subject, providerIdentity.openid, providerIdentity.unionid ?? null,
    new Date().toISOString(), identity.id, identity.userId,
  ).run();
  const canonical = await findWechatIdentity(env, subject, providerIdentity.openid);
  if (!canonical || canonical.userDeletedAt) {
    throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  }
  await bindInstallationToUser(env.DB, current, canonical.userId, {
    kind: 'wechat', identityId: canonical.id,
  });
  return {
    userId: canonical.userId,
    installationId: current.installationId,
    created: false,
  };
}

import { and, eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  authIdentities,
  emailAccounts,
  installations,
  users,
} from '../../db/schema';
import {
  hashEmailPassword,
  verifyEmailPassword,
} from './email-password';
import type { WechatClient } from './wechat-client';
import { hashInstallationToken } from './token';

export interface AuthContext {
  userId: string;
  installationId: string;
}

export interface AuthUser extends AuthContext {
  created: boolean;
}

export type WechatLoginContext = AuthContext;
export type EmailLoginContext = AuthContext;

export async function registerAnonymous(
  db: AppDatabase,
  token: string,
  ageConfirmed14Plus: boolean,
): Promise<AuthUser> {
  const tokenHash = hashInstallationToken(token);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tokenHash}))`);

    const [existing] = await tx
      .select({
        installationId: installations.id,
        userId: installations.userId,
        revokedAt: installations.revokedAt,
        userDeletedAt: users.deletedAt,
      })
      .from(installations)
      .innerJoin(users, eq(users.id, installations.userId))
      .where(eq(installations.tokenHash, tokenHash))
      .limit(1);

    if (existing) {
      if (existing.revokedAt || existing.userDeletedAt) {
        throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
      }
      await tx
        .update(installations)
        .set({ lastSeenAt: new Date() })
        .where(eq(installations.id, existing.installationId));
      return {
        userId: existing.userId,
        installationId: existing.installationId,
        created: false,
      };
    }

    if (!ageConfirmed14Plus) {
      throw new AppError('AGE_CONFIRMATION_REQUIRED', '需要确认已满 14 周岁', 403);
    }

    const [user] = await tx
      .insert(users)
      .values({ kind: 'guest', ageConfirmedAt: new Date() })
      .returning({ id: users.id });
    if (!user) throw new AppError('INTERNAL_ERROR', '身份创建失败', 500, true);

    const [installation] = await tx
      .insert(installations)
      .values({ userId: user.id, tokenHash })
      .returning({ id: installations.id });
    if (!installation) {
      throw new AppError('INTERNAL_ERROR', '身份创建失败', 500, true);
    }

    return {
      userId: user.id,
      installationId: installation.id,
      created: true,
    };
  });
}

export async function authenticateInstallation(
  db: AppDatabase,
  token: string,
): Promise<AuthContext> {
  const tokenHash = hashInstallationToken(token);
  const [existing] = await db
    .select({
      installationId: installations.id,
      userId: installations.userId,
      revokedAt: installations.revokedAt,
      userDeletedAt: users.deletedAt,
    })
    .from(installations)
    .innerJoin(users, eq(users.id, installations.userId))
    .where(eq(installations.tokenHash, tokenHash))
    .limit(1);

  if (!existing) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  if (existing.revokedAt || existing.userDeletedAt) {
    throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  }

  await db
    .update(installations)
    .set({ lastSeenAt: new Date() })
    .where(eq(installations.id, existing.installationId));

  return {
    userId: existing.userId,
    installationId: existing.installationId,
  };
}

export async function loginWithWechat(
  db: AppDatabase,
  context: WechatLoginContext,
  code: string,
  client: WechatClient,
): Promise<AuthUser> {
  const providerIdentity = await client.exchangeCode(code);
  const subject = providerIdentity.unionid ?? providerIdentity.openid;

  return db.transaction(async (tx) => {
    await lockInstallation(tx, context);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${subject}))`);
    const current = await loadCurrentInstallation(tx, context);

    const existing = await findWechatIdentity(tx, subject, providerIdentity.openid);
    if (existing) {
      if (existing.userDeletedAt) {
        throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
      }

      await bindInstallationToUser(tx, current, existing.userId);

      await tx
        .update(authIdentities)
        .set({
          subject,
          openid: providerIdentity.openid,
          unionid: providerIdentity.unionid ?? existing.unionid,
          lastLoginAt: new Date(),
        })
        .where(eq(authIdentities.id, existing.id));

      return {
        userId: existing.userId,
        installationId: current.installationId,
        created: false,
      };
    }

    await tx
      .insert(authIdentities)
      .values({
        userId: current.userId,
        provider: 'wechat',
        subject,
        openid: providerIdentity.openid,
        unionid: providerIdentity.unionid,
      });

    await markUserRegistered(tx, current.userId);

    return {
      userId: current.userId,
      installationId: current.installationId,
      created: true,
    };
  });
}

export async function loginWithEmail(
  db: AppDatabase,
  context: EmailLoginContext,
  email: string,
  password: string,
): Promise<AuthUser> {
  const normalizedEmail = normalizeEmail(email);

  return db.transaction(async (tx) => {
    await lockInstallation(tx, context);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`email:${normalizedEmail}`}))`,
    );

    const current = await loadCurrentInstallation(tx, context);
    const [existing] = await tx
      .select({
        id: emailAccounts.id,
        userId: emailAccounts.userId,
        passwordHash: emailAccounts.passwordHash,
        userDeletedAt: users.deletedAt,
      })
      .from(emailAccounts)
      .innerJoin(users, eq(users.id, emailAccounts.userId))
      .where(eq(emailAccounts.email, normalizedEmail))
      .limit(1);

    if (existing) {
      if (existing.userDeletedAt) {
        throw emailAuthFailed();
      }
      if (!(await verifyEmailPassword(password, existing.passwordHash))) {
        throw emailAuthFailed();
      }

      await bindInstallationToUser(tx, current, existing.userId);
      await tx
        .update(emailAccounts)
        .set({ lastLoginAt: new Date() })
        .where(eq(emailAccounts.id, existing.id));

      return {
        userId: existing.userId,
        installationId: current.installationId,
        created: false,
      };
    }

    const passwordHash = await hashEmailPassword(password);
    await tx.insert(emailAccounts).values({
      userId: current.userId,
      email: normalizedEmail,
      passwordHash,
    });
    await markUserRegistered(tx, current.userId);

    return {
      userId: current.userId,
      installationId: current.installationId,
      created: true,
    };
  });
}

async function findWechatIdentity(
  tx: AppTransaction,
  subject: string,
  openid: string,
) {
  const [bySubject] = await tx
    .select({
      id: authIdentities.id,
      userId: authIdentities.userId,
      unionid: authIdentities.unionid,
      userDeletedAt: users.deletedAt,
    })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(
        eq(authIdentities.provider, 'wechat'),
        eq(authIdentities.subject, subject),
      ),
    )
    .limit(1);
  if (bySubject) return bySubject;

  const [byOpenid] = await tx
    .select({
      id: authIdentities.id,
      userId: authIdentities.userId,
      unionid: authIdentities.unionid,
      userDeletedAt: users.deletedAt,
    })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(
        eq(authIdentities.provider, 'wechat'),
        eq(authIdentities.openid, openid),
      ),
    )
    .limit(1);
  return byOpenid;
}

interface CurrentInstallation extends AuthContext {
  userKind: 'guest' | 'registered';
  revokedAt: Date | null;
  userDeletedAt: Date | null;
}

async function loadCurrentInstallation(
  tx: AppTransaction,
  context: AuthContext,
): Promise<CurrentInstallation> {
  const [current] = await tx
    .select({
      installationId: installations.id,
      userId: installations.userId,
      revokedAt: installations.revokedAt,
      userKind: users.kind,
      userDeletedAt: users.deletedAt,
    })
    .from(installations)
    .innerJoin(users, eq(users.id, installations.userId))
    .where(
      and(
        eq(installations.id, context.installationId),
        eq(installations.userId, context.userId),
      ),
    )
    .limit(1);

  if (!current || current.revokedAt || current.userDeletedAt) {
    throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  }
  return current;
}

async function bindInstallationToUser(
  tx: AppTransaction,
  current: CurrentInstallation,
  targetUserId: string,
): Promise<void> {
  if (targetUserId === current.userId) return;
  if (current.userKind !== 'guest' || !(await isUserEmpty(tx, current.userId))) {
    throw new AppError(
      'AUTH_ACCOUNT_CONFLICT',
      '当前设备已有数据，请先完成账号合并',
      409,
    );
  }

  await tx
    .update(installations)
    .set({ userId: targetUserId, lastSeenAt: new Date() })
    .where(eq(installations.id, current.installationId));
}

async function markUserRegistered(
  tx: AppTransaction,
  userId: string,
): Promise<void> {
  await tx.update(users).set({ kind: 'registered' }).where(eq(users.id, userId));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function lockInstallation(
  tx: AppTransaction,
  context: AuthContext,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`installation:${context.installationId}`}))`,
  );
}

function emailAuthFailed(): AppError {
  return new AppError('EMAIL_AUTH_FAILED', '邮箱或密码错误', 401, false);
}

async function isUserEmpty(tx: AppTransaction, userId: string): Promise<boolean> {
  const result = await tx.execute<{ has_content: boolean }>(sql`
    select (
      exists(select 1 from vocabulary_items where user_id = ${userId}) or
      exists(select 1 from practice_sessions where user_id = ${userId}) or
      exists(select 1 from imported_articles where user_id = ${userId}) or
      exists(select 1 from article_imports where user_id = ${userId}) or
      exists(select 1 from computer_upload_sessions where user_id = ${userId}) or
      exists(select 1 from assistance_events where user_id = ${userId}) or
      exists(select 1 from answer_attempts where user_id = ${userId}) or
      exists(select 1 from idempotency_records where user_id = ${userId}) or
      exists(select 1 from usage_ledger where user_id = ${userId})
    ) as has_content
  `);
  return !result.rows[0]?.has_content;
}

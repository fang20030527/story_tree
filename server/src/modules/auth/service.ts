import { eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { installations, users } from '../../db/schema';
import { hashInstallationToken } from './token';

export interface AuthContext {
  userId: string;
  installationId: string;
}

export interface AuthUser extends AuthContext {
  created: boolean;
}

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

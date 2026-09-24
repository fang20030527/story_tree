import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import {
  emailAccounts,
  emailPasswordResets,
  installations,
  users,
} from '../../db/schema';
import { hashEmailPassword } from './email-password';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const CODE_LIFETIME_MS = 15 * 60_000;
const REQUEST_COOLDOWN_MS = 60_000;
const REQUEST_WINDOW_MS = 60 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_CODE_ATTEMPTS = 5;

export interface IssuedPasswordReset {
  email: string;
  code: string;
}

export function createPasswordResetCode(): string {
  return Array.from(randomBytes(CODE_LENGTH), (byte) =>
    CODE_ALPHABET[byte & 31],
  ).join('');
}

export function hashPasswordResetCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export async function issuePasswordResetCode(
  db: AppDatabase,
  email: string,
): Promise<IssuedPasswordReset | null> {
  const normalizedEmail = email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`email:${normalizedEmail}`}))`,
    );
    const [account] = await tx
      .select({ id: emailAccounts.id })
      .from(emailAccounts)
      .innerJoin(users, eq(users.id, emailAccounts.userId))
      .where(and(eq(emailAccounts.email, normalizedEmail), isNull(users.deletedAt)))
      .limit(1);
    if (!account) return null;

    const [existing] = await tx
      .select()
      .from(emailPasswordResets)
      .where(eq(emailPasswordResets.emailAccountId, account.id))
      .limit(1);
    const now = new Date();
    const inWindow = existing && now.getTime() - existing.windowStartedAt.getTime() < REQUEST_WINDOW_MS;
    if (existing && now.getTime() - existing.createdAt.getTime() < REQUEST_COOLDOWN_MS) {
      return null;
    }
    if (inWindow && existing.requestCount >= MAX_REQUESTS_PER_WINDOW) {
      return null;
    }

    const code = createPasswordResetCode();
    const values = {
      codeHash: hashPasswordResetCode(code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
      attemptsRemaining: MAX_CODE_ATTEMPTS,
      windowStartedAt: inWindow ? existing.windowStartedAt : now,
      requestCount: inWindow ? existing.requestCount + 1 : 1,
    };
    if (existing) {
      await tx.update(emailPasswordResets).set(values)
        .where(eq(emailPasswordResets.emailAccountId, account.id));
    } else {
      await tx.insert(emailPasswordResets).values({ emailAccountId: account.id, ...values });
    }
    return { email: normalizedEmail, code };
  });
}

export async function confirmPasswordReset(
  db: AppDatabase,
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim().toUpperCase();
  const successful = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`email:${normalizedEmail}`}))`,
    );
    const [account] = await tx
      .select({ id: emailAccounts.id, userId: emailAccounts.userId })
      .from(emailAccounts)
      .innerJoin(users, eq(users.id, emailAccounts.userId))
      .where(and(eq(emailAccounts.email, normalizedEmail), isNull(users.deletedAt)))
      .limit(1);
    if (!account) return false;

    const [reset] = await tx.select().from(emailPasswordResets)
      .where(eq(emailPasswordResets.emailAccountId, account.id)).limit(1);
    if (!reset || reset.expiresAt.getTime() <= Date.now() || reset.attemptsRemaining <= 0) {
      return false;
    }

    const actualHash = Buffer.from(hashPasswordResetCode(normalizedCode), 'hex');
    const expectedHash = Buffer.from(reset.codeHash, 'hex');
    if (expectedHash.length !== actualHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      await tx.update(emailPasswordResets).set({
        attemptsRemaining: reset.attemptsRemaining - 1,
      }).where(eq(emailPasswordResets.emailAccountId, account.id));
      return false;
    }

    const now = new Date();
    await tx.update(emailAccounts).set({ passwordHash: await hashEmailPassword(newPassword) })
      .where(eq(emailAccounts.id, account.id));
    await tx.delete(emailPasswordResets)
      .where(eq(emailPasswordResets.emailAccountId, account.id));
    await tx.update(installations).set({ revokedAt: now })
      .where(and(eq(installations.userId, account.userId), isNull(installations.revokedAt)));
    return true;
  });
  if (!successful) {
    throw new AppError('PASSWORD_RESET_CODE_INVALID', '验证码无效或已过期', 400);
  }
}

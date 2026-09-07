import { and, eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { practiceSessions, usageLedger, users } from '../../db/schema';

type QuotaReader = Pick<AppDatabase, 'select'>;

export async function getRemainingQuota(
  db: QuotaReader,
  userId: string,
  freeLimit: number,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageLedger.amount}), 0)::int` })
    .from(usageLedger)
    .where(eq(usageLedger.userId, userId));
  const remaining = freeLimit + (row?.total ?? 0);
  return Math.min(freeLimit, Math.max(0, remaining));
}

export async function reserveQuota(
  tx: AppTransaction,
  userId: string,
  practiceId: string,
  freeLimit: number,
): Promise<number> {
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), sql`${users.deletedAt} is null`))
    .for('no key update');
  if (!owner) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);

  const existingReserve = await tx
    .select({ id: usageLedger.id })
    .from(usageLedger)
    .where(eq(usageLedger.operationKey, `${practiceId}:reserve`))
    .limit(1);
  if (existingReserve.length > 0) {
    return getRemainingQuota(tx, userId, freeLimit);
  }

  const remaining = await getRemainingQuota(tx, userId, freeLimit);
  if (remaining <= 0) {
    throw new AppError('FREE_LIMIT_REACHED', '免费练习额度已用完', 403);
  }

  await tx.insert(usageLedger).values({
    userId,
    practiceSessionId: practiceId,
    kind: 'reserve',
    amount: -1,
    operationKey: `${practiceId}:reserve`,
  });
  return remaining - 1;
}

export async function commitQuota(
  tx: AppTransaction,
  practiceId: string,
): Promise<void> {
  await finalizeQuota(tx, practiceId, 'commit', 0);
}

export async function releaseQuota(
  tx: AppTransaction,
  practiceId: string,
): Promise<void> {
  await finalizeQuota(tx, practiceId, 'release', 1);
}

async function finalizeQuota(
  tx: AppTransaction,
  practiceId: string,
  kind: 'commit' | 'release',
  amount: 0 | 1,
): Promise<void> {
  const [practice] = await tx
    .select({ userId: practiceSessions.userId })
    .from(practiceSessions)
    .where(eq(practiceSessions.id, practiceId))
    .for('update');
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);

  const entries = await tx
    .select({ kind: usageLedger.kind })
    .from(usageLedger)
    .where(eq(usageLedger.practiceSessionId, practiceId));
  const kinds = new Set(entries.map((entry) => entry.kind));
  if (!kinds.has('reserve') || kinds.has('commit') || kinds.has('release')) return;

  await tx
    .insert(usageLedger)
    .values({
      userId: practice.userId,
      practiceSessionId: practiceId,
      kind,
      amount,
      operationKey: `${practiceId}:${kind}`,
    })
    .onConflictDoNothing();
}

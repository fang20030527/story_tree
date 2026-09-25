import { AppError } from '../../../../server/src/core/errors';
import type { D1DatabaseBinding } from '../env';

export interface ReserveQuotaResult {
  /** true only when this call inserted the reserve ledger row. */
  reserved: boolean;
  /** The clamped balance observed after the mutation or idempotent replay. */
  remainingFreePractices: number;
}

export type QuotaFinalizationResult = 'applied' | 'unchanged';

interface IdRow { id: string }
interface TotalRow { total: number }

function assertFreeLimit(freeLimit: number): void {
  if (!Number.isSafeInteger(freeLimit) || freeLimit <= 0) {
    throw new RangeError('freeLimit must be a positive safe integer');
  }
}

export async function getRemainingQuota(
  db: D1DatabaseBinding,
  userId: string,
  freeLimit: number,
): Promise<number> {
  assertFreeLimit(freeLimit);
  const row = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM usage_ledger WHERE user_id = ?1
  `).bind(userId).first<TotalRow>();
  return Math.min(freeLimit, Math.max(0, freeLimit + (row?.total ?? 0)));
}

/**
 * Reserve one free practice. The balance predicate and insert execute as one
 * SQLite write statement, so concurrent requests cannot both spend the last
 * available unit. The operation key makes repeat calls idempotent.
 */
export async function reserveQuota(
  db: D1DatabaseBinding,
  userId: string,
  practiceId: string,
  freeLimit: number,
): Promise<ReserveQuotaResult> {
  assertFreeLimit(freeLimit);
  const operationKey = `${practiceId}:reserve`;
  const inserted = await db.prepare(`
    INSERT INTO usage_ledger
      (id, user_id, practice_session_id, kind, amount, operation_key)
    SELECT ?1, p.user_id, p.id, 'reserve', -1, ?2
    FROM practice_sessions AS p
    JOIN users AS u ON u.id = p.user_id
    WHERE p.id = ?3 AND p.user_id = ?4 AND u.deleted_at IS NULL
      AND ?5 + (
        SELECT COALESCE(SUM(amount), 0)
        FROM usage_ledger WHERE user_id = ?4
      ) > 0
    ON CONFLICT(operation_key) DO NOTHING
    RETURNING id
  `).bind(
    crypto.randomUUID(), operationKey, practiceId, userId, freeLimit,
  ).first<IdRow>();

  if (inserted) {
    return {
      reserved: true,
      remainingFreePractices: await getRemainingQuota(db, userId, freeLimit),
    };
  }

  // A zero-row INSERT can mean a replay, exhausted quota, or an invalid owner.
  // These reads classify the result; they do not decide whether quota may be
  // spent. Only the conditional INSERT above makes that decision.
  const owner = await db.prepare(`
    SELECT id FROM users WHERE id = ?1 AND deleted_at IS NULL LIMIT 1
  `).bind(userId).first<IdRow>();
  if (!owner) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);

  const practice = await db.prepare(`
    SELECT id FROM practice_sessions WHERE id = ?1 AND user_id = ?2 LIMIT 1
  `).bind(practiceId, userId).first<IdRow>();
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);

  const existing = await db.prepare(`
    SELECT id FROM usage_ledger
    WHERE operation_key = ?1 AND user_id = ?2
      AND practice_session_id = ?3 AND kind = 'reserve'
    LIMIT 1
  `).bind(operationKey, userId, practiceId).first<IdRow>();
  if (existing) {
    return {
      reserved: false,
      remainingFreePractices: await getRemainingQuota(db, userId, freeLimit),
    };
  }

  if (await getRemainingQuota(db, userId, freeLimit) <= 0) {
    throw new AppError('FREE_LIMIT_REACHED', '免费练习额度已用完', 403);
  }
  throw new AppError('STATE_CONFLICT', '练习额度预留失败，请重试', 409, true);
}

export function commitQuota(
  db: D1DatabaseBinding,
  practiceId: string,
): Promise<QuotaFinalizationResult> {
  return finalizeQuota(db, practiceId, 'commit', 0);
}

export function releaseQuota(
  db: D1DatabaseBinding,
  practiceId: string,
): Promise<QuotaFinalizationResult> {
  return finalizeQuota(db, practiceId, 'release', 1);
}

/** Exactly one of commit or release may be inserted for a reserved practice. */
async function finalizeQuota(
  db: D1DatabaseBinding,
  practiceId: string,
  kind: 'commit' | 'release',
  amount: 0 | 1,
): Promise<QuotaFinalizationResult> {
  const inserted = await db.prepare(`
    INSERT INTO usage_ledger
      (id, user_id, practice_session_id, kind, amount, operation_key)
    SELECT ?1, p.user_id, p.id, ?2, ?3, ?4
    FROM practice_sessions AS p
    WHERE p.id = ?5
      AND EXISTS (
        SELECT 1 FROM usage_ledger AS reserved
        WHERE reserved.practice_session_id = p.id AND reserved.kind = 'reserve'
      )
      AND NOT EXISTS (
        SELECT 1 FROM usage_ledger AS finalized
        WHERE finalized.practice_session_id = p.id
          AND finalized.kind IN ('commit', 'release')
      )
    ON CONFLICT(operation_key) DO NOTHING
    RETURNING id
  `).bind(
    crypto.randomUUID(), kind, amount, `${practiceId}:${kind}`, practiceId,
  ).first<IdRow>();
  if (inserted) return 'applied';

  const practice = await db.prepare(`
    SELECT id FROM practice_sessions WHERE id = ?1 LIMIT 1
  `).bind(practiceId).first<IdRow>();
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  return 'unchanged';
}

// The ledger mutation is atomic. Creating/updating a practice_session in a
// separate D1 call is not part of that transaction; its caller must handle a
// failed reservation or settlement before exposing the corresponding state.

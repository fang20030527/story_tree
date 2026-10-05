import { AppError } from '../../../../server/src/core/errors';
import { getClientIp, normalizeIpAddress } from '../core/client-ip';
import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';

export interface ReserveQuotaResult {
  /** true only when this call inserted the reserve ledger row. */
  reserved: boolean;
  /** The clamped balance observed after the mutation or idempotent replay. */
  remainingFreePractices: number;
}

export type QuotaFinalizationResult = 'applied' | 'unchanged';

/**
 * Who a free practice is charged to. The account, the device it runs on and the network it
 * comes from each have today's allowance, and a practice needs all three, so a new account or a
 * new browser tab on the same device does not start a fresh allowance.
 */
export interface QuotaScope {
  userId: string;
  /** SHA-256 of the client's persistent device ID; null when the client sends none (old builds). */
  deviceHash: string | null;
  /** SHA-256 of the IPv4 address or IPv6 /64; null when the caller's address is unknown. */
  ipHash: string | null;
}

export interface QuotaLimits {
  /** Free practices per account and per device each day. */
  daily: number;
  /** Free practices per network each day: a looser brake, since carrier NAT shares addresses. */
  ipDaily: number;
}

interface IdRow { id: string }
export interface QuotaUsageRow {
  userUsed: number;
  deviceUsed: number;
  ipUsed: number;
  unlimitedPractices: number;
}

// 旧客户端只接受非负整数额度。此值仅作兼容标记，真正豁免由数据库开关控制。
export const UNLIMITED_PRACTICES_REMAINING = Number.MAX_SAFE_INTEGER;
export const DEFAULT_FREE_PRACTICE_LIMIT = 3;
export const DEFAULT_FREE_PRACTICE_IP_DAILY_LIMIT = 10;

const DEVICE_ID = /^[A-Za-z0-9_-]{16,128}$/u;
const BEIJING_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
/** Usage events only matter for the current day; the scheduled sweep keeps two days. */
const EVENT_RETENTION_MS = 2 * DAY_MS;

function assertLimits(limits: QuotaLimits): void {
  for (const value of [limits.daily, limits.ipDaily]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError('quota limits must be positive safe integers');
    }
  }
}

function limitsOf(limits: QuotaLimits | number): QuotaLimits {
  const resolved = typeof limits === 'number'
    ? { daily: limits, ipDaily: Math.max(limits, DEFAULT_FREE_PRACTICE_IP_DAILY_LIMIT) }
    : limits;
  assertLimits(resolved);
  return resolved;
}

function scopeOf(scope: QuotaScope | string): QuotaScope {
  return typeof scope === 'string' ? { userId: scope, deviceHash: null, ipHash: null } : scope;
}

function positiveSetting(raw: string | number | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('INTERNAL_ERROR', '练习额度配置无效', 500, true);
  }
  return value;
}

export function freePracticeLimits(env: ApiEnv): QuotaLimits {
  return {
    daily: positiveSetting(env.FREE_PRACTICE_LIMIT, DEFAULT_FREE_PRACTICE_LIMIT),
    ipDaily: positiveSetting(env.FREE_PRACTICE_IP_DAILY_LIMIT, DEFAULT_FREE_PRACTICE_IP_DAILY_LIMIT),
  };
}

/** Start of the current day in Beijing time (UTC+8, no daylight saving), as an ISO instant. */
export function quotaDayStart(now = new Date()): string {
  const shifted = now.getTime() + BEIJING_OFFSET_MS;
  return new Date(shifted - (shifted % DAY_MS) - BEIJING_OFFSET_MS).toISOString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** IPv6 clients rotate addresses inside their /64, so the network is the prefix. */
function networkOf(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups.slice(0, 4).map((group) => group.padStart(4, '0')).join(':')}::/64`;
}

/**
 * The device ID is a random value the client keeps across sign-outs (Keychain on iOS,
 * localStorage on the web). Only its digest is stored. Requests behind the HK relay whose
 * client address cannot be verified would all share the relay's address, so they get no
 * network allowance rather than one shared by every relayed user.
 */
export async function quotaScope(request: Request, env: ApiEnv, userId: string): Promise<QuotaScope> {
  const device = request.headers.get('x-device-id')?.trim() ?? '';
  const ip = normalizeIpAddress(await getClientIp(request, env));
  const relays = new Set((env.RELAY_IPS ?? '').split(',').map((item) => normalizeIpAddress(item)));
  return {
    userId,
    deviceHash: DEVICE_ID.test(device) ? await sha256(`device:${device}`) : null,
    ipHash: ip && !relays.has(ip) ? await sha256(`network:${networkOf(ip)}`) : null,
  };
}

const notReleased = (alias: string) => `NOT EXISTS (SELECT 1 FROM usage_ledger AS released
  WHERE released.operation_key = ${alias}.practice_session_id || ':release')`;
const unlimitedAccess = (userParameter: string) => `EXISTS (
  SELECT 1 FROM user_practice_access AS access
  JOIN users AS owner ON owner.id = access.user_id
  WHERE access.user_id = ${userParameter} AND access.unlimited_practices = 1
    AND owner.deleted_at IS NULL)`;

/** Today's reservations that were not released (a failed practice gives its use back). */
export function quotaUsageStatement(
  db: D1DatabaseBinding,
  scope: QuotaScope | string,
  now = new Date(),
): D1StatementBinding {
  const { userId, deviceHash, ipHash } = scopeOf(scope);
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM usage_ledger AS reserve
        WHERE reserve.user_id = ?1 AND reserve.kind = 'reserve' AND reserve.created_at >= ?2
          AND ${notReleased('reserve')}) AS userUsed,
      CASE WHEN ?3 IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM quota_usage_events AS event
        WHERE event.device_hash = ?3 AND event.created_at >= ?2 AND ${notReleased('event')}) END AS deviceUsed,
      CASE WHEN ?4 IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM quota_usage_events AS event
        WHERE event.ip_hash = ?4 AND event.created_at >= ?2 AND ${notReleased('event')}) END AS ipUsed,
      ${unlimitedAccess('?1')} AS unlimitedPractices
  `).bind(userId, quotaDayStart(now), deviceHash, ipHash);
}

export function remainingQuotaFromUsage(
  row: QuotaUsageRow | null | undefined,
  limits: QuotaLimits | number,
): number {
  const { daily, ipDaily } = limitsOf(limits);
  if (row?.unlimitedPractices === 1) return UNLIMITED_PRACTICES_REMAINING;
  const remaining = Math.min(
    daily - (row?.userUsed ?? 0),
    daily - (row?.deviceUsed ?? 0),
    ipDaily - (row?.ipUsed ?? 0),
  );
  return Math.min(daily, Math.max(0, remaining));
}

export async function getRemainingQuota(
  db: D1DatabaseBinding,
  scope: QuotaScope | string,
  limits: QuotaLimits | number = DEFAULT_FREE_PRACTICE_LIMIT,
): Promise<number> {
  const resolved = limitsOf(limits);
  return remainingQuotaFromUsage(
    await quotaUsageStatement(db, scope).first<QuotaUsageRow>(), resolved,
  );
}

/**
 * SQL that is true while the scope may reserve one more free practice today. It is evaluated
 * inside the reserving INSERT, and D1 runs write batches one at a time, so two requests from
 * different accounts on one device cannot both spend that device's last use.
 */
export function freeQuotaAvailable(
  scope: QuotaScope,
  limits: QuotaLimits,
  now = new Date(),
): { sql: string; values: unknown[] } {
  assertLimits(limits);
  const dayStart = quotaDayStart(now);
  return {
    sql: `(
      (SELECT COUNT(*) FROM usage_ledger AS reserve
        WHERE reserve.user_id = ? AND reserve.kind = 'reserve' AND reserve.created_at >= ?
          AND ${notReleased('reserve')}) < ?
      AND (? IS NULL OR (SELECT COUNT(*) FROM quota_usage_events AS event
        WHERE event.device_hash = ? AND event.created_at >= ? AND ${notReleased('event')}) < ?)
      AND (? IS NULL OR (SELECT COUNT(*) FROM quota_usage_events AS event
        WHERE event.ip_hash = ? AND event.created_at >= ? AND ${notReleased('event')}) < ?)
    )`,
    values: [
      scope.userId, dayStart, limits.daily,
      scope.deviceHash, scope.deviceHash, dayStart, limits.daily,
      scope.ipHash, scope.ipHash, dayStart, limits.ipDaily,
    ],
  };
}

/**
 * Charges the device and network once the reservation exists. Rows are not tied to the
 * account, so deleting the account does not hand the device a new allowance. Unlimited
 * accounts do not use up the device's free practices.
 */
export function recordQuotaUsage(
  db: D1DatabaseBinding,
  practiceId: string,
  scope: QuotaScope,
  now = new Date(),
): D1StatementBinding {
  return db.prepare(`
    INSERT INTO quota_usage_events (practice_session_id, device_hash, ip_hash, created_at)
    SELECT ?1, ?2, ?3, ?4
    WHERE (?2 IS NOT NULL OR ?3 IS NOT NULL)
      AND EXISTS (SELECT 1 FROM usage_ledger WHERE operation_key = ?1 || ':reserve')
      AND NOT ${unlimitedAccess('?5')}
    ON CONFLICT(practice_session_id) DO NOTHING
  `).bind(practiceId, scope.deviceHash, scope.ipHash, now.toISOString(), scope.userId);
}

export async function deleteExpiredQuotaUsage(db: D1DatabaseBinding, now = new Date()): Promise<void> {
  await db.prepare('DELETE FROM quota_usage_events WHERE created_at < ?')
    .bind(new Date(now.getTime() - EVENT_RETENTION_MS).toISOString()).run();
}

/**
 * Reserve one free practice. The availability predicate and insert execute as one
 * SQLite write statement, so concurrent requests cannot both spend the last
 * available unit. The operation key makes repeat calls idempotent.
 */
export async function reserveQuota(
  db: D1DatabaseBinding,
  scopeInput: QuotaScope | string,
  practiceId: string,
  limitsInput: QuotaLimits | number,
): Promise<ReserveQuotaResult> {
  const scope = scopeOf(scopeInput);
  const limits = limitsOf(limitsInput);
  const { userId } = scope;
  const operationKey = `${practiceId}:reserve`;
  const now = new Date();
  const available = freeQuotaAvailable(scope, limits, now);
  const [reserved] = await db.batch([
    db.prepare(`
      INSERT INTO usage_ledger
        (id, user_id, practice_session_id, kind, amount, operation_key, created_at)
      SELECT ?, p.user_id, p.id, 'reserve', -1, ?, ?
      FROM practice_sessions AS p
      JOIN users AS u ON u.id = p.user_id
      WHERE p.id = ? AND p.user_id = ? AND u.deleted_at IS NULL
        AND (${unlimitedAccess('u.id')} OR ${available.sql})
      ON CONFLICT(operation_key) DO NOTHING
      RETURNING id
    `).bind(crypto.randomUUID(), operationKey, now.toISOString(), practiceId, userId, ...available.values),
    recordQuotaUsage(db, practiceId, scope, now),
  ]);
  const inserted = reserved && typeof reserved === 'object' && 'results' in reserved &&
    Array.isArray(reserved.results) ? reserved.results[0] as IdRow | undefined : undefined;

  if (inserted) {
    return {
      reserved: true,
      remainingFreePractices: await getRemainingQuota(db, scope, limits),
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
      remainingFreePractices: await getRemainingQuota(db, scope, limits),
    };
  }

  if (await getRemainingQuota(db, scope, limits) <= 0) throw freeLimitReached();
  throw new AppError('STATE_CONFLICT', '练习额度预留失败，请重试', 409, true);
}

export function freeLimitReached(): AppError {
  return new AppError('FREE_LIMIT_REACHED', '今天的免费练习次数已用完，北京时间 0 点后恢复', 403);
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

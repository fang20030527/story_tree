import { isReservedUsername, usernameKey } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv, D1StatementBinding } from '../env';

export interface UsernameClaim {
  username: string;
  key: string;
}

/** 认领用户名时，用来证明这次批处理确实创建了对应登录方式的表和行。 */
export interface UsernameOwner {
  table: 'email_accounts' | 'auth_identities';
  id: string;
}

const FALLBACK_PREFIX = '用户_';
const GENERATED_ATTEMPTS = 3;

export function usernameTaken(): AppError {
  return new AppError('STATE_CONFLICT', '这个用户名已被使用，请换一个', 409);
}

/**
 * 取出请求体校验失败里关于 username 的中文提示，其余校验失败返回 undefined，
 * 由调用方使用原有的通用提示（避免把 zod 的英文信息直接返回给用户）。
 */
export function usernameIssueMessage(error: { issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }> }): string | undefined {
  const issue = error.issues.find(item => item.path[0] === 'username' && item.code === 'custom');
  return issue?.message;
}

/**
 * 从邮箱得到用户名前缀：@ 前的部分，小写，+ 和 ' 换成 _，最多 24 个字符。
 * 不适合公开展示的返回 null：少于 2 个字符、含 [A-Za-z0-9_.-] 以外的字符、没有字母数字、
 * 保留字，或含连续 6 位及以上数字（可能是手机号或 QQ 号）。
 *
 * 必须与 migrations/0009_usernames.sql 的回填规则逐项一致，username-migration.test.ts 会对拍。
 */
export function deriveUsernameBase(email: string): string | null {
  const at = email.indexOf('@');
  if (at < 1) return null;
  const base = email.slice(0, at).replace(/[+']/gu, '_').slice(0, 24);
  if (base.length < 2 || !/^[A-Za-z0-9_.-]+$/u.test(base) || !/[A-Za-z0-9]/u.test(base)) return null;
  const lower = base.toLowerCase();
  if (/\d{6}/u.test(lower) || isReservedUsername(lower)) return null;
  return lower;
}

function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
}

/**
 * 未指定用户名时按优先级排列的候选名：邮箱前缀本身，加随机后缀的前缀，最后是 用户_ 加随机串。
 * 旧版客户端和微信登录都走这里。
 */
export function generatedUsernameCandidates(
  email: string | null,
  random: (length: number) => string = randomHex,
): string[] {
  const base = email ? deriveUsernameBase(email) : null;
  const candidates: string[] = [];
  if (base) {
    candidates.push(base);
    for (let i = 0; i < GENERATED_ATTEMPTS; i++) candidates.push(`${base.slice(0, 15)}_${random(8)}`);
  }
  for (let i = 0; i < GENERATED_ATTEMPTS; i++) candidates.push(`${FALLBACK_PREFIX}${random(8)}`);
  return candidates;
}

async function isKeyTaken(env: ApiEnv, key: string, exceptUserId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE username_key = ? AND id <> ? LIMIT 1')
    .bind(key, exceptUserId).first();
  return row !== null;
}

/**
 * 提前拦截已被占用的名字，避免白白做一次密码哈希；真正的唯一性由数据库唯一索引保证。
 * 账号已经有用户名时（例如已注册账号再绑定另一个邮箱），请求里的名字不会被使用，直接放行。
 */
export async function assertUsernameAvailable(env: ApiEnv, username: string, userId: string): Promise<void> {
  const current = await env.DB.prepare('SELECT username FROM users WHERE id = ?')
    .bind(userId).first<{ username: string | null }>();
  if (current?.username) return;
  if (await isKeyTaken(env, usernameKey(username), userId)) throw usernameTaken();
}

async function freeCandidates(env: ApiEnv, candidates: string[], userId: string): Promise<UsernameClaim[]> {
  const claims = candidates.map(username => ({ username, key: usernameKey(username) }));
  const marks = claims.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT username_key AS usernameKey FROM users WHERE username_key IN (${marks}) AND id <> ?`,
  ).bind(...claims.map(claim => claim.key), userId).all<{ usernameKey: string }>();
  const taken = new Set(rows.results.map(row => row.usernameKey));
  return claims.filter(claim => !taken.has(claim.key));
}

function claimStatement(
  env: ApiEnv,
  userId: string,
  claim: UsernameClaim,
  owner: UsernameOwner,
): D1StatementBinding {
  // 只有这次批处理确实新建了登录方式，并且账号还没有用户名时才写入；
  // 唯一索引冲突会让整个批处理回滚，账号不会被创建。
  return env.DB.prepare(`
    UPDATE users SET username = ?, username_key = ?
    WHERE id = ? AND username IS NULL AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM ${owner.table} WHERE id = ? AND user_id = ?)
  `).bind(claim.username, claim.key, userId, owner.id, userId);
}

const unavailable = () =>
  new AppError('DATABASE_UNAVAILABLE', '账号暂时无法创建，请稍后重试', 503, true);

/**
 * 在创建新登录方式的同一个 D1 批处理里原子地认领用户名。
 * - requested：用户指定的名字。被占用时整个批处理回滚并返回 409，账号不会被创建。
 * - 未指定：依次尝试自动生成的候选名，某个候选撞上唯一索引时换下一个。
 */
export async function runRegistrationBatch(
  env: ApiEnv,
  args: {
    userId: string;
    email: string | null;
    requested: string | undefined;
    owner: UsernameOwner;
    statements: D1StatementBinding[];
  },
): Promise<void> {
  const { userId, email, requested, owner, statements } = args;
  const claims = requested
    ? [{ username: requested, key: usernameKey(requested) }]
    : await freeCandidates(env, generatedUsernameCandidates(email), userId);

  for (const claim of claims) {
    try {
      await env.DB.batch([...statements, claimStatement(env, userId, claim, owner)]);
      return;
    } catch (error) {
      if (!(await isKeyTaken(env, claim.key, userId))) throw error;
      if (requested) throw usernameTaken();
    }
  }
  throw unavailable();
}

/**
 * 保证已注册账号有用户名：正常情况下注册时已经分配，这里兜住迁移回填之后、
 * 新版 API 上线之前由旧版 API 创建的账号，以及任何回填遗漏。游客返回 null。
 */
export async function ensureUsername(env: ApiEnv, userId: string): Promise<string | null> {
  const user = await env.DB.prepare('SELECT kind, username FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId).first<{ kind: string; username: string | null }>();
  if (!user) return null;
  if (user.username || user.kind !== 'registered') return user.username;

  const account = await env.DB.prepare(
    'SELECT email FROM email_accounts WHERE user_id = ? ORDER BY created_at, id LIMIT 1',
  ).bind(userId).first<{ email: string }>();
  for (const claim of await freeCandidates(env, generatedUsernameCandidates(account?.email ?? null), userId)) {
    try {
      const updated = await env.DB.prepare(`
        UPDATE users SET username = ?, username_key = ?
        WHERE id = ? AND username IS NULL AND kind = 'registered' AND deleted_at IS NULL
        RETURNING username
      `).bind(claim.username, claim.key, userId).first<{ username: string }>();
      if (updated) return updated.username;
      break;
    } catch (error) {
      if (!(await isKeyTaken(env, claim.key, userId))) throw error;
    }
  }
  // 没有更新到行：并发请求已经设置了用户名，或账号刚被删除；重新读取为准。
  const latest = await env.DB.prepare('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId).first<{ username: string | null }>();
  return latest?.username ?? null;
}

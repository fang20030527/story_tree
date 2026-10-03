import {
  AccountProfileSchema, UpdateUsernameRequestSchema, usernameKey,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import { ensureUsername, usernameIssueMessage, usernameTaken } from '../auth/username';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';

const PATH = '/v1/account';
const USERNAME_PATH = `${PATH}/username`;

interface UserRow {
  kind: 'guest' | 'registered';
  username: string | null;
}

const json = (body: unknown) =>
  Response.json(body, { headers: { 'cache-control': 'no-store' } });

async function loadUser(env: ApiEnv, userId: string): Promise<UserRow> {
  const user = await env.DB.prepare('SELECT kind, username FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId).first<UserRow>();
  if (!user) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  return user;
}

async function updateUsername(env: ApiEnv, userId: string, username: string): Promise<void> {
  const key = usernameKey(username);
  const occupied = await env.DB.prepare('SELECT id FROM users WHERE username_key = ? AND id <> ? LIMIT 1')
    .bind(key, userId).first();
  if (occupied) throw usernameTaken();
  try {
    const updated = await env.DB.prepare(`
      UPDATE users SET username = ?, username_key = ?
      WHERE id = ? AND kind = 'registered' AND deleted_at IS NULL
      RETURNING id
    `).bind(username, key, userId).first();
    if (!updated) throw new AppError('TOKEN_REVOKED', '身份凭据已失效', 401);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // 检查与更新之间被别人占用时，唯一索引会拒绝写入；其他错误原样抛出。
    const raced = await env.DB.prepare('SELECT id FROM users WHERE username_key = ? AND id <> ? LIMIT 1')
      .bind(key, userId).first();
    if (raced) throw usernameTaken();
    throw error;
  }
}

export async function handleAccountRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== PATH && pathname !== USERNAME_PATH) return null;

  if (pathname === PATH) {
    if (request.method !== 'GET') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
    const user = await loadUser(env, userId);
    // 注册时已分配用户名；这里兜住迁移回填之后、新版 API 上线之前创建的账号。
    const username = user.kind === 'registered' ? await ensureUsername(env, userId) : user.username;
    return json(AccountProfileSchema.parse({ kind: user.kind, username }));
  }

  if (request.method !== 'PUT') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
  const parsed = UpdateUsernameRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', usernameIssueMessage(parsed.error) ?? '请检查输入内容', 400);
  }
  const { username } = parsed.data;
  const user = await loadUser(env, userId);
  if (user.kind !== 'registered') {
    throw new AppError('UNAUTHORIZED', '请先登录后再修改用户名', 403);
  }
  // 与当前名字完全相同时不写库，重复提交是幂等的。
  if (user.username !== username) await updateUsername(env, userId, username);
  return json(AccountProfileSchema.parse({ kind: 'registered', username }));
}

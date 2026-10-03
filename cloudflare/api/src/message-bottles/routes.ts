import {
  CreateMessageBottleSchema, MessageBottleDtoSchema, MessageBottleListQuerySchema,
  MessageBottlePageSchema, MessageBottleProfileSchema, type CreateMessageBottle,
} from '@context-reader/contracts';
import { AppError } from '../../../../server/src/core/errors';
import {
  decodeMessageBottleCursor, encodeMessageBottleCursor, messageBottleLoginRequired,
  messageBottleRateLimited, messageBottleUsernameChanged, messageBottleUsernameKey,
  messageBottleUsernameTaken, MESSAGE_BOTTLE_POST_LIMIT, MESSAGE_BOTTLE_WINDOW_MS,
} from '../../../../server/src/modules/message-bottles/shared';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';

const PATH = '/v1/message-bottles';
const OPERATION = 'create_message_bottle';
interface UserRow { username: string | null; kind: string; }
interface MessageRow { id: string; user_id: string; username: string; content: string; created_at: string; }
interface ReplayRow { request_hash: string; resource_id: string; }
const owned = 'EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)';
const unavailable = () => new AppError('DATABASE_UNAVAILABLE', '留言暂时无法访问，请稍后重试', 503, true);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const dto = (row: MessageRow, userId: string) => MessageBottleDtoSchema.parse({ id: row.id, username: row.username,
  content: row.content, createdAt: row.created_at, isMine: row.user_id === userId });

async function profile(env: ApiEnv, userId: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT username, kind FROM users WHERE id = ? AND deleted_at IS NULL').bind(userId).first<UserRow>();
}
async function replay(env: ApiEnv, userId: string, key: string, hash: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT request_hash, resource_id FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?')
    .bind(userId, OPERATION, key).first<ReplayRow>();
  if (row && row.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  return row?.resource_id ?? null;
}
async function readMessage(env: ApiEnv, id: string, userId: string) {
  const row = await env.DB.prepare('SELECT * FROM message_bottles WHERE id = ? AND user_id = ?').bind(id, userId).first<MessageRow>();
  if (!row) throw new AppError('NOT_FOUND', '留言不存在', 404);
  return dto(row, userId);
}
async function validatePost(env: ApiEnv, userId: string, input: CreateMessageBottle, since: string) {
  const user = await profile(env, userId);
  if (user?.kind !== 'registered') throw messageBottleLoginRequired();
  if (user.username && user.username !== input.username) throw messageBottleUsernameChanged();
  const occupied = await env.DB.prepare('SELECT id FROM users WHERE username_key = ? AND id <> ?')
    .bind(messageBottleUsernameKey(input.username), userId).first();
  if (occupied) throw messageBottleUsernameTaken();
  const count = await env.DB.prepare('SELECT count(*) AS total FROM message_bottles WHERE user_id = ? AND created_at >= ?')
    .bind(userId, since).first<{ total: number }>();
  if ((count?.total ?? 0) >= MESSAGE_BOTTLE_POST_LIMIT) throw messageBottleRateLimited();
}
async function create(env: ApiEnv, userId: string, input: CreateMessageBottle, key: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ content: input.content, username: input.username })));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if ((await profile(env, userId))?.kind !== 'registered') throw messageBottleLoginRequired();
  const previous = await replay(env, userId, key, hash);
  if (previous) return readMessage(env, previous, userId);
  const now = new Date(); const createdAt = now.toISOString();
  const since = new Date(now.getTime() - MESSAGE_BOTTLE_WINDOW_MS).toISOString();
  await validatePost(env, userId, input, since);
  const id = crypto.randomUUID(); const recordId = crypto.randomUUID(); const guardId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO idempotency_records
        (id, user_id, operation, idempotency_key, request_hash, resource_type, resource_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'message_bottle', ?, ?, ?) ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING`)
        .bind(recordId, userId, OPERATION, key, hash, id, createdAt, new Date(now.getTime() + 30 * 86_400_000).toISOString()),
      env.DB.prepare(`UPDATE users SET username = ?, username_key = ? WHERE id = ? AND kind = 'registered'
        AND deleted_at IS NULL AND (username IS NULL OR username = ?) AND ${owned}`)
        .bind(input.username, messageBottleUsernameKey(input.username), userId, input.username, recordId),
      env.DB.prepare(`INSERT INTO message_bottles(id, user_id, username, content, created_at)
        SELECT ?, id, username, ?, ? FROM users WHERE id = ? AND kind = 'registered' AND deleted_at IS NULL
        AND username = ? AND ${owned}
        AND (SELECT count(*) FROM message_bottles WHERE user_id = ? AND created_at >= ?) < ?`)
        .bind(id, input.content, createdAt, userId, input.username, recordId, userId, since, MESSAGE_BOTTLE_POST_LIMIT),
      // D1 条件写入未命中时需要显式回滚，避免只保存用户名或幂等记录。
      env.DB.prepare(`INSERT INTO transaction_guards(id, valid)
        SELECT ?, CASE WHEN NOT ${owned} OR EXISTS (SELECT 1 FROM message_bottles WHERE id = ?) THEN 1 ELSE 0 END`)
        .bind(guardId, recordId, id),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
    ]);
  } catch {
    const completed = await replay(env, userId, key, hash);
    if (completed) return readMessage(env, completed, userId);
    await validatePost(env, userId, input, since);
    throw unavailable();
  }
  const resourceId = await replay(env, userId, key, hash);
  if (!resourceId) throw unavailable();
  return readMessage(env, resourceId, userId);
}

export async function handleMessageBottleRoute(request: Request, env: ApiEnv, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== PATH && url.pathname !== `${PATH}/profile`) return null;
  if (url.pathname.endsWith('/profile')) {
    if (request.method !== 'GET') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
    const user = await profile(env, userId);
    if (!user) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
    return json(MessageBottleProfileSchema.parse({ username: user.username, canPost: user.kind === 'registered' }));
  }
  if (request.method === 'POST') {
    const key = request.headers.get('idempotency-key');
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/u.test(key)) throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
    const parsed = CreateMessageBottleSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请填写 2–24 字的用户名和 1–1000 字的留言', 400);
    return json(await create(env, userId, parsed.data, key), 201);
  }
  if (request.method !== 'GET') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
  if ([...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) {
    throw new AppError('VALIDATION_ERROR', '留言分页参数无效', 400);
  }
  const parsed = MessageBottleListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '留言分页参数无效', 400);
  const { limit } = parsed.data;
  const cursor = parsed.data.cursor ? decodeMessageBottleCursor(parsed.data.cursor) : null;
  const rows = await env.DB.prepare(`SELECT * FROM message_bottles
    ${cursor ? 'WHERE created_at < ? OR (created_at = ? AND id < ?)' : ''}
    ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1).all<MessageRow>();
  const items = rows.results.slice(0, limit).map(row => dto(row, userId)); const last = items.at(-1);
  return json(MessageBottlePageSchema.parse({ items, nextCursor: rows.results.length > limit && last
    ? encodeMessageBottleCursor(last.createdAt, last.id) : null }));
}

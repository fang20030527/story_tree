import {
  BlockedUsersSchema, CreateMessageBottleSchema, MessageBottleDtoSchema, MessageBottleListQuerySchema,
  MessageBottlePageSchema, MessageBottleProfileSchema, MessageBottleReviewedDtoSchema,
  MessageBottleReviewedPageSchema, ReportMessageBottleRequestSchema, UuidSchema, type CreateMessageBottle,
  MessageBottleThreadDtoSchema, MessageBottleThreadPageSchema,
} from '@context-reader/contracts';
import { AppError } from '../../../../server/src/core/errors';
import {
  decodeMessageBottleCursor, encodeMessageBottleCursor, messageBottleLoginRequired,
  messageBottleRateLimited, messageBottleUsernameChanged, messageBottleUsernameKey,
  messageBottleUsernameTaken, MESSAGE_BOTTLE_POST_LIMIT, MESSAGE_BOTTLE_WINDOW_MS,
} from '../../../../server/src/modules/message-bottles/shared';
import { notifyModerators } from '../admin/notify';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';
import { readMessageBottleReplies } from './replies';

const PATH = '/v1/message-bottles';
const BLOCKED_PATH = '/v1/blocked-users';
const ACTION_PATH = /^\/v1\/message-bottles\/([^/]+)\/(report|block)$/u;
const UNBLOCK_PATH = /^\/v1\/blocked-users\/([^/]+)$/u;
const OPERATION = 'create_message_bottle';
/** Distinct open reports that take a public bottle down until a moderator looks at it. */
export const REPORTS_TO_HIDE = 3;
interface UserRow { username: string | null; kind: string; }
interface MessageRow {
  id: string; user_id: string; username: string; content: string; created_at: string;
  status: 'visible' | 'pending' | 'hidden';
}
interface ReplayRow { request_hash: string; resource_id: string; }
const owned = 'EXISTS (SELECT 1 FROM idempotency_records WHERE id = ?)';
const unavailable = () => new AppError('DATABASE_UNAVAILABLE', '留言暂时无法访问，请稍后重试', 503, true);
const notFound = () => new AppError('NOT_FOUND', '留言不存在', 404);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
// A bottle keeps the name it was signed with when posted (see the account rename tests).
const SELECT_MESSAGE = `SELECT bottle.id, bottle.user_id, bottle.username, bottle.content, bottle.created_at, bottle.status
  FROM message_bottles AS bottle`;

function dto(row: MessageRow, userId: string, withStatus: boolean) {
  const base = { id: row.id, username: row.username, content: row.content, createdAt: row.created_at, isMine: row.user_id === userId };
  return withStatus ? MessageBottleReviewedDtoSchema.parse({ ...base, status: row.status }) : MessageBottleDtoSchema.parse(base);
}

/** 'pre' (the default) holds new bottles until a moderator approves them; 'post' publishes at once. */
function reviewFirst(env: ApiEnv): boolean {
  return env.MESSAGE_BOTTLE_REVIEW !== 'post';
}

async function profile(env: ApiEnv, userId: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT username, kind FROM users WHERE id = ? AND deleted_at IS NULL').bind(userId).first<UserRow>();
}
async function replay(env: ApiEnv, userId: string, key: string, hash: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT request_hash, resource_id FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?')
    .bind(userId, OPERATION, key).first<ReplayRow>();
  if (row && row.request_hash !== hash) throw new AppError('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求', 409);
  return row?.resource_id ?? null;
}
async function readMessage(env: ApiEnv, id: string, userId: string, withStatus: boolean) {
  const row = await env.DB.prepare(`${SELECT_MESSAGE} WHERE bottle.id = ? AND bottle.user_id = ?`).bind(id, userId).first<MessageRow>();
  if (!row) throw notFound();
  return dto(row, userId, withStatus);
}
async function assertNotBanned(env: ApiEnv, userId: string) {
  const banned = await env.DB.prepare('SELECT 1 AS banned FROM user_moderation WHERE user_id = ? AND posting_banned_at IS NOT NULL')
    .bind(userId).first();
  if (banned) throw new AppError('MESSAGE_BOTTLE_BANNED', '你的账号已被限制发布留言', 403);
}
async function validatePost(env: ApiEnv, userId: string, input: CreateMessageBottle, since: string) {
  const user = await profile(env, userId);
  if (user?.kind !== 'registered') throw messageBottleLoginRequired();
  await assertNotBanned(env, userId);
  if (user.username && user.username !== input.username) throw messageBottleUsernameChanged();
  const occupied = await env.DB.prepare('SELECT id FROM users WHERE username_key = ? AND id <> ?')
    .bind(messageBottleUsernameKey(input.username), userId).first();
  if (occupied) throw messageBottleUsernameTaken();
  const count = await env.DB.prepare('SELECT count(*) AS total FROM message_bottles WHERE user_id = ? AND created_at >= ?')
    .bind(userId, since).first<{ total: number }>();
  if ((count?.total ?? 0) >= MESSAGE_BOTTLE_POST_LIMIT) throw messageBottleRateLimited();
}
async function create(env: ApiEnv, userId: string, input: CreateMessageBottle, key: string, withStatus: boolean,
  consoleUrl: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ content: input.content, username: input.username })));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if ((await profile(env, userId))?.kind !== 'registered') throw messageBottleLoginRequired();
  const previous = await replay(env, userId, key, hash);
  if (previous) return readMessage(env, previous, userId, withStatus);
  const now = new Date(); const createdAt = now.toISOString();
  const since = new Date(now.getTime() - MESSAGE_BOTTLE_WINDOW_MS).toISOString();
  await validatePost(env, userId, input, since);
  const status = reviewFirst(env) ? 'pending' : 'visible';
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
      env.DB.prepare(`INSERT INTO message_bottles(id, user_id, username, content, created_at, status)
        SELECT ?, id, username, ?, ?, ? FROM users WHERE id = ? AND kind = 'registered' AND deleted_at IS NULL
        AND username = ? AND ${owned}
        AND NOT EXISTS (SELECT 1 FROM user_moderation WHERE user_id = users.id AND posting_banned_at IS NOT NULL)
        AND (SELECT count(*) FROM message_bottles WHERE user_id = ? AND created_at >= ?) < ?`)
        .bind(id, input.content, createdAt, status, userId, input.username, recordId, userId, since, MESSAGE_BOTTLE_POST_LIMIT),
      // D1 条件写入未命中时需要显式回滚，避免只保存用户名或幂等记录。
      env.DB.prepare(`INSERT INTO transaction_guards(id, valid)
        SELECT ?, CASE WHEN NOT ${owned} OR EXISTS (SELECT 1 FROM message_bottles WHERE id = ?) THEN 1 ELSE 0 END`)
        .bind(guardId, recordId, id),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id = ?').bind(guardId),
    ]);
  } catch {
    const completed = await replay(env, userId, key, hash);
    if (completed) return readMessage(env, completed, userId, withStatus);
    await validatePost(env, userId, input, since);
    throw unavailable();
  }
  const resourceId = await replay(env, userId, key, hash);
  if (!resourceId) throw unavailable();
  if (status === 'pending') await notifyModerators(env, consoleUrl);
  return readMessage(env, resourceId, userId, withStatus);
}

async function list(url: URL, env: ApiEnv, userId: string): Promise<Response> {
  if ([...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) {
    throw new AppError('VALIDATION_ERROR', '留言分页参数无效', 400);
  }
  const parsed = MessageBottleListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '留言分页参数无效', 400);
  const { limit, includeStatus, includeReply } = parsed.data;
  const cursor = parsed.data.cursor ? decodeMessageBottleCursor(parsed.data.cursor) : null;
  // Everyone sees public bottles; authors also see their own while under review. Bottles by
  // people the viewer blocked, and bottles the viewer reported, disappear for the viewer at once.
  const rows = await env.DB.prepare(`${SELECT_MESSAGE}
    WHERE (bottle.status = 'visible' OR bottle.user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = bottle.user_id)
      AND NOT EXISTS (SELECT 1 FROM message_bottle_reports WHERE bottle_id = bottle.id AND reporter_id = ?)
      ${cursor ? 'AND (bottle.created_at < ? OR (bottle.created_at = ? AND bottle.id < ?))' : ''}
    ORDER BY bottle.created_at DESC, bottle.id DESC LIMIT ?`)
    .bind(userId, userId, userId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1)
    .all<MessageRow>();
  const withStatus = includeStatus === '1' || includeReply === '1';
  const items = rows.results.slice(0, limit).map(row => dto(row, userId, withStatus)); const last = items.at(-1);
  const page = { items, nextCursor: rows.results.length > limit && last ? encodeMessageBottleCursor(last.createdAt, last.id) : null };
  if (includeReply === '1') {
    const replies = await readMessageBottleReplies(env, items.map(item => item.id));
    return json(MessageBottleThreadPageSchema.parse({
      ...page, items: items.map(item => ({ ...item, reply: replies.get(item.id) ?? null })),
    }));
  }
  return json(withStatus ? MessageBottleReviewedPageSchema.parse(page) : MessageBottlePageSchema.parse(page));
}

async function otherAuthor(env: ApiEnv, bottleId: string, userId: string, selfMessage: string): Promise<string> {
  if (!UuidSchema.safeParse(bottleId).success) throw notFound();
  const row = await env.DB.prepare(`SELECT user_id FROM message_bottles WHERE id = ? AND (status = 'visible' OR user_id = ?)`)
    .bind(bottleId, userId).first<{ user_id: string }>();
  if (!row) throw notFound();
  if (row.user_id === userId) throw new AppError('VALIDATION_ERROR', selfMessage, 400);
  return row.user_id;
}

async function report(request: Request, env: ApiEnv, userId: string, bottleId: string, consoleUrl: string): Promise<Response> {
  const parsed = ReportMessageBottleRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请选择举报原因，补充说明不超过 200 字', 400);
  await otherAuthor(env, bottleId, userId, '不能举报自己的留言');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO message_bottle_reports (id, bottle_id, reporter_id, reason, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(bottle_id, reporter_id) DO NOTHING`)
      .bind(crypto.randomUUID(), bottleId, userId, parsed.data.reason, parsed.data.detail ?? null, now),
    env.DB.prepare(`UPDATE message_bottles SET status = 'pending'
      WHERE id = ? AND status = 'visible'
        AND (SELECT COUNT(*) FROM message_bottle_reports WHERE bottle_id = ? AND resolved_at IS NULL) >= ?`)
      .bind(bottleId, bottleId, REPORTS_TO_HIDE),
  ]);
  // Every report is reviewed; the note goes out at most every half hour.
  await notifyModerators(env, consoleUrl);
  return noContent();
}

async function block(env: ApiEnv, userId: string, bottleId: string): Promise<Response> {
  const author = await otherAuthor(env, bottleId, userId, '不能屏蔽自己');
  await env.DB.prepare(`INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT(blocker_id, blocked_id) DO NOTHING`).bind(userId, author, new Date().toISOString()).run();
  return noContent();
}

async function blockedUsers(env: ApiEnv, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(`SELECT block.blocked_id AS userId, person.username, block.created_at AS blockedAt
    FROM user_blocks AS block JOIN users AS person ON person.id = block.blocked_id
    WHERE block.blocker_id = ? ORDER BY block.created_at DESC LIMIT 500`)
    .bind(userId).all<{ userId: string; username: string | null; blockedAt: string }>();
  return json(BlockedUsersSchema.parse({ users: rows.results }));
}

export async function handleMessageBottleRoute(request: Request, env: ApiEnv, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  const consoleUrl = new URL('/v1/admin/moderation', url).toString();
  if (url.pathname === BLOCKED_PATH) {
    if (request.method !== 'GET') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
    return blockedUsers(env, userId);
  }
  const unblock = UNBLOCK_PATH.exec(url.pathname);
  if (unblock) {
    if (request.method !== 'DELETE') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
    await env.DB.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').bind(userId, unblock[1]!).run();
    return noContent();
  }
  const action = ACTION_PATH.exec(url.pathname);
  if (action) {
    if (request.method !== 'POST') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
    return action[2] === 'report' ? report(request, env, userId, action[1]!, consoleUrl) : block(env, userId, action[1]!);
  }
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
    const withReply = url.searchParams.get('includeReply') === '1';
    const message = await create(env, userId, parsed.data, key, withReply || url.searchParams.get('includeStatus') === '1', consoleUrl);
    if (withReply) {
      const replies = await readMessageBottleReplies(env, [message.id]);
      return json(MessageBottleThreadDtoSchema.parse({ ...message, reply: replies.get(message.id) ?? null }), 201);
    }
    return json(message, 201);
  }
  if (request.method !== 'GET') throw new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);
  return list(url, env, userId);
}

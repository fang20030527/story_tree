import {
  MessageBottleDeveloperAccessSchema, MessageBottleModerationPageSchema, MessageBottleModerationQuerySchema,
  MessageBottleReplyInputSchema, MessageBottleReplyResultSchema, UuidSchema,
  type MessageBottleModerationItem,
} from '@context-reader/contracts';
import { AppError } from '../../../../server/src/core/errors';
import { decodeMessageBottleCursor, encodeMessageBottleCursor } from '../../../../server/src/modules/message-bottles/shared';
import { bottleAction, userAction } from '../admin/moderation';
import { readJsonBody } from '../core/http';
import type { ApiEnv } from '../env';
import { readMessageBottleReplies } from './replies';

const PREFIX = '/v1/developer/';
const BOTTLE_ACTION = /^\/v1\/developer\/message-bottles\/([^/]+)\/(approve|hide|delete|reply)$/u;
const USER_ACTION = /^\/v1\/developer\/users\/([^/]+)\/(ban|unban)$/u;
const FILTERS = {
  pending: "bottle.status = 'pending'",
  reported: 'EXISTS (SELECT 1 FROM message_bottle_reports AS report WHERE report.bottle_id = bottle.id AND report.resolved_at IS NULL)',
  hidden: "bottle.status = 'hidden'",
  recent: '1 = 1',
} as const;
const json = (body: unknown) => Response.json(body, { headers: { 'cache-control': 'no-store' } });
const notFound = () => new AppError('NOT_FOUND', '留言不存在', 404);
const methodError = () => new AppError('VALIDATION_ERROR', '不支持此请求方式', 405);

export async function canModerateMessageBottles(env: ApiEnv, userId: string): Promise<boolean> {
  const allowed = (env.DEVELOPER_USER_IDS ?? '').split(',').map(id => id.trim()).filter(id => UuidSchema.safeParse(id).success);
  if (!allowed.includes(userId)) return false;
  return !!await env.DB.prepare("SELECT id FROM users WHERE id = ? AND kind = 'registered' AND deleted_at IS NULL").bind(userId).first();
}

interface BottleRow {
  id: string; username: string; content: string; createdAt: string; status: string; reviewedAt: string | null;
  authorId: string; authorName: string | null; bannedAt: string | null;
}
type ReportRow = MessageBottleModerationItem['reports'][number] & { bottleId: string };

async function list(url: URL, env: ApiEnv) {
  const parsed = MessageBottleModerationQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1))
    throw new AppError('VALIDATION_ERROR', '审核列表参数无效', 400);
  const { view, limit } = parsed.data;
  const cursor = parsed.data.cursor ? decodeMessageBottleCursor(parsed.data.cursor) : null;
  const rows = (await env.DB.prepare(`
    SELECT bottle.id, bottle.username, bottle.content, bottle.created_at AS createdAt,
      bottle.status, bottle.reviewed_at AS reviewedAt, author.id AS authorId, author.username AS authorName,
      moderation.posting_banned_at AS bannedAt
    FROM message_bottles AS bottle JOIN users AS author ON author.id = bottle.user_id
    LEFT JOIN user_moderation AS moderation ON moderation.user_id = author.id
    WHERE ${FILTERS[view]}
      ${cursor ? 'AND (bottle.created_at < ? OR (bottle.created_at = ? AND bottle.id < ?))' : ''}
    ORDER BY bottle.created_at DESC, bottle.id DESC LIMIT ?
  `).bind(...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1).all<BottleRow>()).results;
  const page = rows.slice(0, limit);
  const ids = page.map(row => row.id);
  const [replies, reports] = await Promise.all([
    readMessageBottleReplies(env, ids),
    ids.length ? env.DB.prepare(`SELECT bottle_id AS bottleId, reason, detail, created_at AS createdAt
      FROM message_bottle_reports WHERE resolved_at IS NULL AND bottle_id IN (SELECT value FROM json_each(?))
      ORDER BY created_at, id`).bind(JSON.stringify(ids)).all<ReportRow>().then(result => result.results) : Promise.resolve([]),
  ]);
  const last = page.at(-1);
  return json(MessageBottleModerationPageSchema.parse({
    view,
    items: page.map(({ authorId, authorName, bannedAt, ...row }) => ({
      ...row, author: { id: authorId, username: authorName, banned: bannedAt !== null },
      reports: reports.filter(report => report.bottleId === row.id).map(({ reason, detail, createdAt }) => ({ reason, detail, createdAt })),
      reply: replies.get(row.id) ?? null,
    })),
    nextCursor: rows.length > limit && last ? encodeMessageBottleCursor(last.createdAt, last.id) : null,
  }));
}

async function reply(request: Request, env: ApiEnv, userId: string, bottleId: string) {
  if (request.method !== 'PUT' && request.method !== 'DELETE') throw methodError();
  if (!await env.DB.prepare('SELECT id FROM message_bottles WHERE id = ?').bind(bottleId).first()) throw notFound();
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM message_bottle_replies WHERE bottle_id = ?').bind(bottleId).run();
    return json(MessageBottleReplyResultSchema.parse({ reply: null }));
  }
  const parsed = MessageBottleReplyInputSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请填写 1–1000 字的开发者回复', 400);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO message_bottle_replies (bottle_id, user_id, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bottle_id) DO UPDATE SET user_id = excluded.user_id, content = excluded.content, updated_at = excluded.updated_at
    WHERE message_bottle_replies.content <> excluded.content
  `).bind(bottleId, userId, parsed.data.content, now, now).run();
  const saved = (await readMessageBottleReplies(env, [bottleId])).get(bottleId);
  if (!saved) throw notFound();
  return json(MessageBottleReplyResultSchema.parse({ reply: saved }));
}

/** The Worker must authenticate the normal installation token before dispatching here. */
export async function handleDeveloperMessageBottleRoute(request: Request, env: ApiEnv, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return null;
  const allowed = await canModerateMessageBottles(env, userId);
  if (url.pathname === `${PREFIX}access`) {
    if (request.method !== 'GET') throw methodError();
    return json(MessageBottleDeveloperAccessSchema.parse({ canModerate: allowed }));
  }
  if (!allowed) throw new AppError('DEVELOPER_REQUIRED', '此操作需要开发者账号权限', 403);
  if (url.pathname === `${PREFIX}message-bottles`) {
    if (request.method !== 'GET') throw methodError();
    return list(url, env);
  }
  const bottle = BOTTLE_ACTION.exec(url.pathname);
  if (bottle) {
    const id = UuidSchema.safeParse(bottle[1]);
    if (!id.success) throw notFound();
    if (bottle[2] === 'reply') return reply(request, env, userId, id.data);
    if (request.method !== 'POST') throw methodError();
    return bottleAction(env, id.data, bottle[2] as 'approve' | 'hide' | 'delete');
  }
  const author = USER_ACTION.exec(url.pathname);
  if (author) {
    if (request.method !== 'POST') throw methodError();
    const id = UuidSchema.safeParse(author[1]);
    if (!id.success) throw notFound();
    return userAction(env, id.data, author[2] as 'ban' | 'unban');
  }
  throw new AppError('NOT_FOUND', '资源不存在', 404);
}

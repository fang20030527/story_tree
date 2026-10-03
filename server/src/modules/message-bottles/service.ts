import {
  CreateMessageBottleSchema, MessageBottleDtoSchema, MessageBottlePageSchema, MessageBottleProfileSchema,
  type CreateMessageBottle, type MessageBottleListQuery,
} from '@context-reader/contracts';
import { and, count, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { messageBottles, users } from '../../db/schema';
import { beginIdempotentOperation, finishIdempotentOperation } from '../idempotency/service';
import {
  decodeMessageBottleCursor, encodeMessageBottleCursor, messageBottleLoginRequired,
  messageBottleRateLimited, messageBottleUsernameChanged, messageBottleUsernameKey,
  messageBottleUsernameTaken, MESSAGE_BOTTLE_POST_LIMIT, MESSAGE_BOTTLE_WINDOW_MS,
} from './shared';

function dto(row: typeof messageBottles.$inferSelect, viewerId: string) {
  return MessageBottleDtoSchema.parse({ id: row.id, username: row.username, content: row.content,
    createdAt: row.createdAt.toISOString(), isMine: row.userId === viewerId });
}

export async function getMessageBottleProfile(db: AppDatabase, userId: string) {
  const [user] = await db.select({ username: users.username, kind: users.kind }).from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
  if (!user) throw new AppError('UNAUTHORIZED', '身份凭据无效', 401);
  return MessageBottleProfileSchema.parse({ username: user.username, canPost: user.kind === 'registered' });
}

export async function getMessageBottlePage(db: AppDatabase, viewerId: string, query: MessageBottleListQuery) {
  const cursor = query.cursor ? decodeMessageBottleCursor(query.cursor) : null;
  const rows = await db.select().from(messageBottles).where(cursor ? or(
    lt(messageBottles.createdAt, new Date(cursor.createdAt)),
    and(eq(messageBottles.createdAt, new Date(cursor.createdAt)), lt(messageBottles.id, cursor.id)),
  ) : undefined).orderBy(desc(messageBottles.createdAt), desc(messageBottles.id)).limit(query.limit + 1);
  const items = rows.slice(0, query.limit).map(row => dto(row, viewerId));
  const last = items.at(-1);
  return MessageBottlePageSchema.parse({ items, nextCursor: rows.length > query.limit && last
    ? encodeMessageBottleCursor(last.createdAt, last.id) : null });
}

export async function createMessageBottle(db: AppDatabase, userId: string, request: CreateMessageBottle, key: string) {
  const parsed = CreateMessageBottleSchema.safeParse(request);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请填写 2–24 字的用户名和 1–1000 字的留言', 400);
  const input = parsed.data;
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`message-bottle:${userId}`}))`);
    const [user] = await tx.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1).for('update');
    if (user?.kind !== 'registered') throw messageBottleLoginRequired();
    const existingId = await beginIdempotentOperation(tx, userId, 'create_message_bottle', key, input);
    if (existingId) {
      const [existing] = await tx.select().from(messageBottles)
        .where(and(eq(messageBottles.id, existingId), eq(messageBottles.userId, userId))).limit(1);
      if (!existing) throw new AppError('NOT_FOUND', '留言不存在', 404);
      return dto(existing, userId);
    }
    if (user.username && user.username !== input.username) throw messageBottleUsernameChanged();
    const usernameKey = messageBottleUsernameKey(input.username);
    if (!user.username) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`message-bottle-name:${usernameKey}`}))`);
      const [occupied] = await tx.select({ id: users.id }).from(users).where(eq(users.usernameKey, usernameKey)).limit(1);
      if (occupied && occupied.id !== userId) throw messageBottleUsernameTaken();
    }
    const now = new Date();
    const [recent] = await tx.select({ total: count() }).from(messageBottles)
      .where(and(eq(messageBottles.userId, userId), gte(messageBottles.createdAt, new Date(now.getTime() - MESSAGE_BOTTLE_WINDOW_MS))));
    if ((recent?.total ?? 0) >= MESSAGE_BOTTLE_POST_LIMIT) throw messageBottleRateLimited();
    if (!user.username) await tx.update(users).set({ username: input.username, usernameKey }).where(eq(users.id, userId));
    const [row] = await tx.insert(messageBottles).values({ userId, ...input, createdAt: now }).returning();
    if (!row) throw new AppError('INTERNAL_ERROR', '留言投递失败，请重试', 500, true);
    await finishIdempotentOperation(tx, userId, 'create_message_bottle', key, row.id);
    return dto(row, userId);
  });
}

import { CreateMessageBottleSchema, MessageBottleListQuerySchema } from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { createMessageBottle, getMessageBottlePage, getMessageBottleProfile } from './service';

export const messageBottleRoutes: FastifyPluginAsync<{ db: AppDatabase }> = async (app, { db }) => {
  app.addHook('preHandler', requireAuth(db));
  app.addHook('onSend', async (_request, reply) => { reply.header('cache-control', 'no-store'); });
  app.get('/v1/message-bottles/profile', request => getMessageBottleProfile(db, request.authUser.userId));
  app.get('/v1/message-bottles', async request => {
    const query = MessageBottleListQuerySchema.safeParse(request.query);
    if (!query.success) throw new AppError('VALIDATION_ERROR', '留言分页参数无效', 400);
    return getMessageBottlePage(db, request.authUser.userId, query.data);
  });
  app.post('/v1/message-bottles', async (request, reply) => {
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const parsed = CreateMessageBottleSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', '请填写 2–24 字的用户名和 1–1000 字的留言', 400);
    return reply.code(201).send(await createMessageBottle(db, request.authUser.userId, parsed.data, key));
  });
};

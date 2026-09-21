import {
  VocabularyInputSchema,
  VocabularyItemDtoSchema,
  VocabularyPageSchema,
  VocabularyTimeZoneSchema,
  VocabularyWordFilterSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import {
  createVocabularyItemForUser,
  getVocabularyPage,
} from './service';
import { getVocabularyWordContexts, getVocabularyWordPage, setVocabularyWordMastery } from './word-service';

export interface VocabularyRoutesOptions {
  db: AppDatabase;
}

export const vocabularyRoutes: FastifyPluginAsync<
  VocabularyRoutesOptions
> = async (app, options) => {
  app.get('/v1/vocabulary-words', { preHandler: requireAuth(options.db) }, async (request, reply) => {
    const query = request.query as { cursor?: unknown; limit?: unknown; filter?: unknown; timeZone?: unknown };
    const filter = VocabularyWordFilterSchema.safeParse(query.filter ?? 'learning');
    if (!filter.success) throw new AppError('VALIDATION_ERROR', '词库筛选格式无效', 400);
    const timeZone = parseTimeZone(query.timeZone);
    return reply.send(await getVocabularyWordPage(options.db, {
      userId: request.authUser.userId, filter: filter.data,
      limit: parseLimit(query.limit), cursor: parseCursorParameter(query.cursor),
      ...(timeZone ? { timeZone } : {}),
    }));
  });
  app.get('/v1/vocabulary-words/:wordId/contexts', { preHandler: requireAuth(options.db) }, async (request, reply) => {
    const { wordId } = request.params as { wordId: string };
    return reply.send(await getVocabularyWordContexts(options.db, request.authUser.userId, wordId));
  });
  for (const [action, mastered] of [['mastered', true], ['unmaster', false]] as const) {
    app.post(`/v1/vocabulary-words/:wordId/${action}`, { preHandler: requireAuth(options.db) }, async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      const { wordId } = request.params as { wordId: string };
      return reply.send(await setVocabularyWordMastery(options.db, {
        userId: request.authUser.userId, wordId, mastered, idempotencyKey,
      }));
    });
  }
  app.post(
    '/v1/vocabulary-items',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = VocabularyInputSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '词义格式无效', 400);
      }
      const item = await createVocabularyItemForUser(options.db, {
        userId: request.authUser.userId,
        item: parsed.data,
        idempotencyKey,
      });
      return reply.code(201).send(VocabularyItemDtoSchema.parse(item));
    },
  );

  app.get(
    '/v1/vocabulary-items',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const query = request.query as { cursor?: unknown; limit?: unknown };
      const cursor = parseCursorParameter(query.cursor);
      const limit = parseLimit(query.limit);
      const page = await getVocabularyPage(options.db, {
        userId: request.authUser.userId,
        cursor,
        limit,
      });
      return reply.send(VocabularyPageSchema.parse(page));
    },
  );
};

function parseTimeZone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = VocabularyTimeZoneSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  }
  return parsed.data;
}

function parseCursorParameter(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', '词库游标格式无效', 400);
  }
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 20;
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  const limit = Number(value);
  if (limit < 1 || limit > 50) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  return limit;
}

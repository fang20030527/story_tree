import { VocabularyPageSchema } from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireAuth } from '../auth/routes';
import { getVocabularyPage } from './service';

export interface VocabularyRoutesOptions {
  db: AppDatabase;
}

export const vocabularyRoutes: FastifyPluginAsync<
  VocabularyRoutesOptions
> = async (app, options) => {
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

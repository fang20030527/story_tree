import {
  ImportedArticleDtoSchema,
  ImportedArticlePageSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { parseUuidParam } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { getArticleForUser, listArticlesForUser } from './service';

export interface ArticlesRoutesOptions {
  db: AppDatabase;
}

const ARTICLE_LIMIT_PATTERN = /^\d{1,3}$/u;

function parseArticleCursor(query: Record<string, unknown>): string | null {
  const raw = query.cursor;
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('VALIDATION_ERROR', '文章游标格式无效', 400);
  }
  return raw;
}

function parseArticleLimit(query: Record<string, unknown>): number {
  const raw = query.limit;
  if (raw === undefined) {
    return 30;
  }
  if (typeof raw !== 'string' || !ARTICLE_LIMIT_PATTERN.test(raw)) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  const limit = Number.parseInt(raw, 10);
  if (limit < 1 || limit > 100) {
    throw new AppError('VALIDATION_ERROR', '分页数量格式无效', 400);
  }
  return limit;
}

export const articlesRoutes: FastifyPluginAsync<ArticlesRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    '/v1/articles',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const page = await listArticlesForUser(options.db, {
        userId: request.authUser.userId,
        cursor: parseArticleCursor(query),
        limit: parseArticleLimit(query),
      });
      return reply.send(ImportedArticlePageSchema.parse(page));
    },
  );

  app.get(
    '/v1/articles/:id',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const articleId = parseUuidParam(
        request.params,
        'id',
        '文章编号格式无效',
      );
      const article = await getArticleForUser(options.db, {
        userId: request.authUser.userId,
        articleId,
      });
      return reply.send(ImportedArticleDtoSchema.parse(article));
    },
  );
};

import { ImportedArticleDtoSchema } from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { AppDatabase } from '../../db/client';
import { parseUuidParam } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { getArticleForUser } from './service';

export interface ArticlesRoutesOptions {
  db: AppDatabase;
}

export const articlesRoutes: FastifyPluginAsync<ArticlesRoutesOptions> = async (
  app,
  options,
) => {
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

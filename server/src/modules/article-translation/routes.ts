import {
  ArticleTranslationDtoSchema,
  TranslationRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import {
  getArticleTranslationForUser,
  requestArticleTranslation,
} from './service';

export interface ArticleTranslationRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export const articleTranslationRoutes: FastifyPluginAsync<
  ArticleTranslationRoutesOptions
> = async (app, options) => {
  app.post(
    '/v1/articles/:id/translations',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const articleId = parseUuidParam(
        request.params,
        'id',
        '文章编号格式无效',
      );
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = TranslationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '翻译范围格式无效', 400);
      }
      const translation = await requestArticleTranslation(options.db, {
        userId: request.authUser.userId,
        articleId,
        request: parsed.data,
        idempotencyKey,
        deadlineMs: options.config.generationDeadlineMs,
      });
      return reply
        .status(translation.status === 'ready' ? 200 : 202)
        .send(ArticleTranslationDtoSchema.parse(translation));
    },
  );

  app.get(
    '/v1/article-translations/:id',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const translationId = parseUuidParam(
        request.params,
        'id',
        '翻译编号格式无效',
      );
      const translation = await getArticleTranslationForUser(options.db, {
        userId: request.authUser.userId,
        translationId,
      });
      return reply.send(ArticleTranslationDtoSchema.parse(translation));
    },
  );
};

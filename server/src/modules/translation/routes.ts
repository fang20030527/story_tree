import {
  TranslationDtoSchema,
  TranslationRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { getTranslationForUser, requestTranslation } from './service';

export interface TranslationRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export const translationRoutes: FastifyPluginAsync<
  TranslationRoutesOptions
> = async (app, options) => {
  app.post(
    '/v1/practices/:id/translations',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const practiceId = parseUuidParam(request.params, 'id', '练习编号格式无效');
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = TranslationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '翻译范围格式无效', 400);
      }

      const translation = await requestTranslation(options.db, {
        userId: request.authUser.userId,
        practiceId,
        request: parsed.data,
        idempotencyKey,
        deadlineMs: options.config.generationDeadlineMs,
      });
      return reply
        .status(translation.status === 'ready' ? 200 : 202)
        .send(TranslationDtoSchema.parse(translation));
    },
  );

  app.get(
    '/v1/translations/:id',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const translationId = parseUuidParam(
        request.params,
        'id',
        '翻译编号格式无效',
      );
      const translation = await getTranslationForUser(options.db, {
        userId: request.authUser.userId,
        translationId,
      });
      return reply.send(TranslationDtoSchema.parse(translation));
    },
  );
};

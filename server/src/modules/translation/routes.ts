import {
  TranslationDtoSchema,
  TranslationRequestSchema,
  WordTranslationDtoSchema,
  WordTranslationRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import type { AiProvider } from '../../infrastructure/ai/types';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { getTranslationForUser, requestTranslation } from './service';
import { validateTranslationText } from './validation';

export interface TranslationRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
  wordProvider?: Pick<AiProvider, 'lookupWord'>;
}

export const translationRoutes: FastifyPluginAsync<
  TranslationRoutesOptions
> = async (app, options) => {
  app.post(
    '/v1/word-translations',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const parsed = WordTranslationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '词语格式无效', 400);
      }
      if (!options.wordProvider) {
        throw new AppError('AI_UNAVAILABLE', '翻译服务暂时不可用', 503, true);
      }
      const rawMeaning = await options.wordProvider.lookupWord(
        parsed.data.term,
        parsed.data.context,
        new AbortController().signal,
      );
      if (typeof rawMeaning !== 'string') {
        throw new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
      }
      const meaningZh = validateTranslationText(rawMeaning);
      if (meaningZh.length > 200) {
        throw new AppError('AI_INVALID_OUTPUT', '翻译结果格式无效', 502, true);
      }
      return reply.send(
        WordTranslationDtoSchema.parse({
          term: parsed.data.term,
          meaningZh,
        }),
      );
    },
  );

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

import {
  TranslationDtoSchema,
  TranslationRequestSchema,
  UuidSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireAuth } from '../auth/routes';
import { getTranslationForUser, requestTranslation } from './service';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

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
      const idempotencyKey = request.headers['idempotency-key'];
      if (
        typeof idempotencyKey !== 'string' ||
        !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
      ) {
        throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
      }
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

function parseUuidParam(
  params: unknown,
  name: string,
  message: string,
): string {
  const value =
    typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)[name]
      : undefined;
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', message, 400);
  return parsed.data;
}

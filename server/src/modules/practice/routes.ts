import {
  CreatePracticeAcceptedSchema,
  CreatePracticeRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireAuth } from '../auth/routes';
import { createPractice } from './create-service';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface PracticeRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export const practiceRoutes: FastifyPluginAsync<PracticeRoutesOptions> = async (
  app,
  options,
) => {
  app.post(
    '/v1/practices',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'];
      if (
        typeof idempotencyKey !== 'string' ||
        !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
      ) {
        throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
      }

      const parsed = CreatePracticeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '请检查词义输入', 400);
      }

      const created = await createPractice(options.db, {
        userId: request.authUser.userId,
        idempotencyKey,
        items: parsed.data.items,
        freeLimit: options.config.freePracticeLimit,
        generationDeadlineMs: options.config.generationDeadlineMs,
      });
      const body = CreatePracticeAcceptedSchema.parse(created);
      return reply.status(202).send(body);
    },
  );
};

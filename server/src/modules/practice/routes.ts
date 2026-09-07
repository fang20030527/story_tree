import {
  AnswerResultSchema,
  AssistanceRequestSchema,
  AssistanceResponseSchema,
  CreatePracticeAcceptedSchema,
  CreatePracticeRequestSchema,
  PracticeDtoSchema,
  SubmitAnswerRequestSchema,
  UuidSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireAuth } from '../auth/routes';
import { submitFirstAnswer } from './answer-service';
import { recordAssistance } from './assistance-service';
import { createPractice } from './create-service';
import { getPracticeForUser } from './get-service';

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
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );

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

  app.post(
    '/v1/practices/:id/assistance',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const practiceId = parsePracticeId(request.params);
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = AssistanceRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '请检查辅助请求', 400);
      }

      const response = await recordAssistance(options.db, {
        userId: request.authUser.userId,
        practiceId,
        request: parsed.data,
        idempotencyKey,
      });
      return reply.send(AssistanceResponseSchema.parse(response));
    },
  );

  app.post(
    '/v1/practices/:id/answers',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const practiceId = parsePracticeId(request.params);
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = SubmitAnswerRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '请检查答题内容', 400);
      }

      const response = await submitFirstAnswer(options.db, {
        userId: request.authUser.userId,
        practiceId,
        idempotencyKey,
        ...parsed.data,
      });
      return reply.send(AnswerResultSchema.parse(response));
    },
  );

  app.get(
    '/v1/practices/:id',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const practiceId = parsePracticeId(request.params);
      const practice = await getPracticeForUser(options.db, {
        userId: request.authUser.userId,
        practiceId,
        freeLimit: options.config.freePracticeLimit,
      });
      return reply.send(PracticeDtoSchema.parse(practice));
    },
  );
};

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AppError('VALIDATION_ERROR', '幂等键格式无效', 400);
  }
  return value;
}

function parsePracticeId(params: unknown): string {
  const parsed = UuidSchema.safeParse((params as { id?: unknown }).id);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', '练习编号格式无效', 400);
  }
  return parsed.data;
}

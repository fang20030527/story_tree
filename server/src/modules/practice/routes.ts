import {
  AnswerResultSchema,
  AssistanceRequestSchema,
  AssistanceResponseSchema,
  CreatePracticeAcceptedSchema,
  CreatePracticeRequestSchema,
  PracticeDtoSchema,
  RetryFailedTopicsRequestSchema,
  RetryFailedTopicsResponseSchema,
  SubmitAnswerRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { submitFirstAnswer } from './answer-service';
import { recordAssistance } from './assistance-service';
import {
  createPractice,
  createPracticeFromVocabulary,
} from './create-service';
import { getPracticeForUser } from './get-service';
import { retryFailedTopicArticles } from './retry-failed-service';

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
        throw new AppError('VALIDATION_ERROR', '请检查练习创建请求', 400);
      }

      const commonInput = {
        userId: request.authUser.userId,
        idempotencyKey,
        freeLimit: options.config.freePracticeLimit,
        generationDeadlineMs: options.config.generationDeadlineMs,
        ...(parsed.data.format ? { format: parsed.data.format } : {}),
      };
      const created = 'items' in parsed.data
        ? await createPractice(options.db, {
            ...commonInput,
            items: parsed.data.items,
          })
        : await createPracticeFromVocabulary(options.db, {
            ...commonInput,
            targetCount: parsed.data.targetCount,
          });
      const body = CreatePracticeAcceptedSchema.parse(created);
      return reply.status(202).send(body);
    },
  );

  app.post(
    '/v1/practices/:id/assistance',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const practiceId = parseUuidParam(
        request.params,
        'id',
        '练习编号格式无效',
      );
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
      const practiceId = parseUuidParam(
        request.params,
        'id',
        '练习编号格式无效',
      );
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
      const practiceId = parseUuidParam(
        request.params,
        'id',
        '练习编号格式无效',
      );
      const practice = await getPracticeForUser(options.db, {
        userId: request.authUser.userId,
        practiceId,
        freeLimit: options.config.freePracticeLimit,
      });
      const response = PracticeDtoSchema.parse(practice);
      if ((request.query as { includeProgress?: unknown }).includeProgress === '1' || !response.group) {
        return reply.send(response);
      }
      // Installed clients reject unknown group fields, so keep their original shape.
      return reply.send({
        ...response,
        group: {
          id: response.group.id,
          articles: response.group.articles.map((article) => ({
            id: article.id,
            topic: article.topic,
            status: article.status,
            title: article.title,
            wordCount: article.wordCount,
            failureMessage: article.failureMessage,
          })),
        },
      });
    },
  );

  app.post(
    '/v1/practices/:id/retry-failed',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const groupId = parseUuidParam(request.params, 'id', '主题练习编号格式无效');
      const idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']);
      if (!RetryFailedTopicsRequestSchema.safeParse(request.body).success) {
        throw new AppError('VALIDATION_ERROR', '请检查重试请求', 400);
      }
      const result = await retryFailedTopicArticles(options.db, {
        userId: request.authUser.userId,
        groupId,
        idempotencyKey,
        generationDeadlineMs: options.config.generationDeadlineMs,
      });
      return reply.send(RetryFailedTopicsResponseSchema.parse(result));
    },
  );
};

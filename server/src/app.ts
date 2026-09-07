import { randomUUID } from 'node:crypto';

import { PublicErrorSchema } from '@context-reader/contracts';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { ServerConfig } from './config/env';
import { AppError } from './core/errors';
import type { AppDatabase } from './db/client';
import { authPlugin } from './modules/auth/plugin';

export const redactPaths = [
  'req.headers.authorization',
  'request.headers.authorization',
  'DATABASE_URL',
  'EVOLINK_API_KEY',
  '*.article',
  '*.plainText',
  '*.sourceSentence',
  '*.meaningZh',
  '*.translatedTextZh',
];

interface BuildAppOptions {
  config: ServerConfig;
  db: AppDatabase;
  logger?: boolean;
  readiness?: () => Promise<boolean>;
}

function toPublicError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const fastifyError = error as FastifyError;
  if (fastifyError.validation || fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    return new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
  }

  return new AppError('INTERNAL_ERROR', '服务暂时无法完成请求', 500, true);
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger:
      options.logger === false
        ? false
        : {
            level: options.config.LOG_LEVEL,
            redact: { paths: redactPaths, censor: '[REDACTED]' },
          },
  });
  const readiness = options.readiness ?? (async () => true);

  app.decorateRequest('authUser');
  app.register(authPlugin, { config: options.config, db: options.db });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => {
    try {
      if (!(await readiness())) throw new Error('Readiness check returned false');
      return { status: 'ok' };
    } catch {
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        '数据库暂时无法访问',
        503,
        true,
      );
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const publicError = toPublicError(error);
    if (!(error instanceof AppError)) {
      request.log.error({ err: error }, 'Unhandled request error');
    }
    const body = PublicErrorSchema.parse({
      error: {
        code: publicError.code,
        message: publicError.message,
        requestId: request.id,
        retryable: publicError.retryable,
      },
    });
    return reply.status(publicError.statusCode).send(body);
  });

  return app;
}

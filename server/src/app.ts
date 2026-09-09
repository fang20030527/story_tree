import { randomUUID } from 'node:crypto';

import { PublicErrorSchema } from '@context-reader/contracts';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';

import type { ServerConfig } from './config/env';
import { AppError } from './core/errors';
import type { AppDatabase } from './db/client';
import { articleTranslationRoutes } from './modules/article-translation/routes';
import { articlesRoutes } from './modules/articles/routes';
import { authPlugin } from './modules/auth/plugin';
import { computerUploadRoutes } from './modules/computer-upload/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { importsRoutes } from './modules/imports/routes';
import { practiceRoutes } from './modules/practice/routes';
import { translationRoutes } from './modules/translation/routes';
import { vocabularyRoutes } from './modules/vocabulary/routes';
import {
  registerSecurity,
  type SecurityLimits,
} from './plugins/security';

export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'request.headers.authorization',
  'request.headers.cookie',
  'request.body',
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
  loggerStream?: DestinationStream;
  readiness?: () => Promise<boolean>;
  readinessTimeoutMs?: number;
  securityLimits?: Partial<SecurityLimits>;
}

function toPublicError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const fastifyError = error as FastifyError;
  if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new AppError('VALIDATION_ERROR', '请求内容过大', 413);
  }
  if (fastifyError.validation || fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
    return new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
  }

  return new AppError('INTERNAL_ERROR', '服务暂时无法完成请求', 500, true);
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: 32 * 1_024,
    genReqId: () => randomUUID(),
    logger:
      options.logger === false
        ? false
        : {
            level: options.config.LOG_LEVEL,
            redact: { paths: redactPaths, censor: '[REDACTED]' },
            ...(options.loggerStream ? { stream: options.loggerStream } : {}),
          },
    trustProxy: false,
  });
  const readiness = options.readiness ?? (async () => true);
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 2_000;

  app.decorateRequest('authUser');
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  registerSecurity(app, options.config, options.securityLimits);
  app.register(authPlugin, { config: options.config, db: options.db });
  app.register(importsRoutes, { config: options.config, db: options.db });
  app.register(articlesRoutes, { db: options.db });
  app.register(articleTranslationRoutes, {
    config: options.config,
    db: options.db,
  });
  app.register(practiceRoutes, { config: options.config, db: options.db });
  app.register(translationRoutes, { config: options.config, db: options.db });
  app.register(vocabularyRoutes, { db: options.db });
  app.register(dashboardRoutes, { config: options.config, db: options.db });
  app.register(computerUploadRoutes, {
    config: options.config,
    db: options.db,
  });

  app.get(
    '/health/live',
    { config: { rateLimit: false } },
    async () => ({ status: 'ok' }),
  );
  app.get(
    '/health/ready',
    { config: { rateLimit: false } },
    async () => {
      try {
        const ready = await runWithDeadline(readiness, readinessTimeoutMs);
        if (!ready) throw new Error('Readiness check returned false');
        return { status: 'ok' };
      } catch {
        throw new AppError(
          'DATABASE_UNAVAILABLE',
          '数据库暂时无法访问',
          503,
          true,
        );
      }
    },
  );

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

async function runWithDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Operation deadline exceeded')),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { PublicErrorSchema } from '@context-reader/contracts';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import type { DestinationStream } from 'pino';

import type { ServerConfig } from './config/env';
import { AppError, errorCodes } from './core/errors';
import type { AppDatabase } from './db/client';
import { articleTranslationRoutes } from './modules/article-translation/routes';
import { articlesRoutes } from './modules/articles/routes';
import { authPlugin } from './modules/auth/plugin';
import type { WechatClient } from './modules/auth/wechat-client';
import type { AiProvider } from './infrastructure/ai/types';
import { computerUploadRoutes } from './modules/computer-upload/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { editorialImageRoutes } from './modules/editorial/routes';
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
  'WECHAT_APP_SECRET',
  '*.sourceUrl',
  '*.previewText',
  '*.previewTitle',
  '*.filename',
  '*.uploadCode',
  '*.capabilityToken',
  '*.codeHash',
  '*.capabilityTokenHash',
  '*.content',
  '*.base64',
  '*.text',
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
  wechatClient?: WechatClient;
  sentenceTranslationProvider?: Pick<AiProvider, 'translate'>;
  wordTranslationProvider?: Pick<AiProvider, 'lookupWord'>;
}

const knownErrorCodes = new Set<string>(errorCodes);
const parserLimitCodes = new Set([
  'FST_ERR_CTP_BODY_TOO_LARGE',
  'FST_REQ_FILE_TOO_LARGE',
  'FST_FILES_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PARTS_LIMIT',
]);

function toPublicError(error: unknown, request: FastifyRequest): AppError {
  if (error instanceof AppError) return error;

  const fastifyError = error as FastifyError;
  if (
    isImportUploadRequest(request) &&
    typeof fastifyError.code === 'string' &&
    parserLimitCodes.has(fastifyError.code)
  ) {
    return new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }
  if (
    isImportUploadRequest(request) &&
    fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
  ) {
    return new AppError('IMPORT_UNSUPPORTED_TYPE', '上传文件类型不支持', 415);
  }
  if (fastifyError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new AppError('VALIDATION_ERROR', '请求内容过大', 413);
  }
  if (
    fastifyError.validation ||
    fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    fastifyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
  ) {
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
  app.register(editorialImageRoutes, {
    assetDirectory: fileURLToPath(new URL('../assets/editorial/epub/', import.meta.url)),
  });
  app.register(authPlugin, {
    config: options.config,
    db: options.db,
    ...(options.wechatClient ? { wechatClient: options.wechatClient } : {}),
  });
  app.register(importsRoutes, { config: options.config, db: options.db });
  app.register(articlesRoutes, { db: options.db });
  app.register(articleTranslationRoutes, {
    config: options.config,
    db: options.db,
  });
  app.register(practiceRoutes, { config: options.config, db: options.db });
  app.register(translationRoutes, {
    config: options.config,
    db: options.db,
    ...(options.sentenceTranslationProvider
      ? { sentenceProvider: options.sentenceTranslationProvider }
      : {}),
    ...(options.wordTranslationProvider
      ? { wordProvider: options.wordTranslationProvider }
      : {}),
  });
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
    const publicError = toPublicError(error, request);
    if (!(error instanceof AppError)) {
      request.log.error(
        {
          errorType: 'UnexpectedError',
          errorCode: safeLogErrorCode(error),
        },
        'Unhandled request error',
      );
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

function isImportUploadRequest(request: FastifyRequest): boolean {
  const route = request.routeOptions.url ?? '';
  return route.startsWith('/v1/imports') || route === '/computer-upload/file';
}

function safeLogErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'UNCLASSIFIED';
  if (knownErrorCodes.has(code) || /^(?:ERR|FST)_[A-Z0-9_]+$/u.test(code)) {
    return code;
  }
  return 'UNCLASSIFIED';
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

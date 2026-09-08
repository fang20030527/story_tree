import type { Readable } from 'node:stream';

import {
  ArticleImportDtoSchema,
  ConfirmArticleImportRequestSchema,
  CreateArticleImportRequestSchema,
  UpdateImportPreviewRequestSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { readBoundedStream } from '../../http/stream';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import {
  cancelArticleImport,
  confirmArticleImport,
  createArticleImport,
  getArticleImportForUser,
  putPastedSource,
  updateImportPreview,
} from './service';

const EmptyRequestSchema = z.object({}).strict();

export interface ImportsRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export const importsRoutes: FastifyPluginAsync<ImportsRoutesOptions> = async (
  app,
  options,
) => {
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('text/plain', (_request, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });

  app.post(
    '/v1/imports',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = CreateArticleImportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '请检查导入来源', 400);
      }
      const created = await createArticleImport(options.db, {
        userId: request.authUser.userId,
        idempotencyKey,
        request: parsed.data,
        draftTtlMs: options.config.IMPORT_DRAFT_TTL_MS,
        jobDeadlineMs: options.config.IMPORT_JOB_DEADLINE_MS,
      });
      return reply.status(201).send(ArticleImportDtoSchema.parse(created));
    },
  );

  app.put(
    '/v1/imports/:id/source-text',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const importId = parseUuidParam(
        request.params,
        'id',
        '导入任务编号格式无效',
      );
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      assertPlainText(request.headers['content-type']);
      const contentLength = parseContentLength(
        request.headers['content-length'],
      );
      const { content } = await readBoundedStream(request.body as Readable, {
        contentLength,
        maxBytes: options.config.IMPORT_MAX_TEXT_BYTES,
      });
      const updated = await putPastedSource(options.db, {
        userId: request.authUser.userId,
        importId,
        idempotencyKey,
        content,
      });
      return reply.send(ArticleImportDtoSchema.parse(updated));
    },
  );

  app.get(
    '/v1/imports/:id',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const importId = parseUuidParam(
        request.params,
        'id',
        '导入任务编号格式无效',
      );
      const articleImport = await getArticleImportForUser(options.db, {
        userId: request.authUser.userId,
        importId,
      });
      return reply.send(ArticleImportDtoSchema.parse(articleImport));
    },
  );

  app.patch(
    '/v1/imports/:id/preview',
    { bodyLimit: 128 * 1_024, preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const importId = parseUuidParam(
        request.params,
        'id',
        '导入任务编号格式无效',
      );
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = UpdateImportPreviewRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '请检查预览内容', 400);
      }
      const updated = await updateImportPreview(options.db, {
        userId: request.authUser.userId,
        importId,
        idempotencyKey,
        request: parsed.data,
      });
      return reply.send(ArticleImportDtoSchema.parse(updated));
    },
  );

  app.post(
    '/v1/imports/:id/confirm',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const importId = parseUuidParam(
        request.params,
        'id',
        '导入任务编号格式无效',
      );
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const parsed = ConfirmArticleImportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', '请检查确认选项', 400);
      }
      const confirmed = await confirmArticleImport(options.db, {
        userId: request.authUser.userId,
        importId,
        idempotencyKey,
        request: parsed.data,
      });
      return reply.send(ArticleImportDtoSchema.parse(confirmed));
    },
  );

  app.post(
    '/v1/imports/:id/cancel',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const importId = parseUuidParam(
        request.params,
        'id',
        '导入任务编号格式无效',
      );
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      if (!EmptyRequestSchema.safeParse(request.body ?? {}).success) {
        throw new AppError('VALIDATION_ERROR', '取消请求格式无效', 400);
      }
      const cancelled = await cancelArticleImport(options.db, {
        userId: request.authUser.userId,
        importId,
        idempotencyKey,
      });
      return reply.send(ArticleImportDtoSchema.parse(cancelled));
    },
  );
};

function parseContentLength(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new AppError(
      'VALIDATION_ERROR',
      '必须提供准确的 Content-Length',
      411,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AppError(
      'VALIDATION_ERROR',
      '必须提供准确的 Content-Length',
      411,
    );
  }
  return parsed;
}

function assertPlainText(value: unknown): void {
  const essence =
    typeof value === 'string'
      ? value.split(';', 1)[0]?.trim().toLowerCase()
      : undefined;
  if (essence !== 'text/plain') {
    throw new AppError(
      'IMPORT_UNSUPPORTED_TYPE',
      '粘贴正文必须使用纯文本格式',
      415,
    );
  }
}

import { createHash } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import {
  ComputerUploadSessionDtoSchema,
  CreatedComputerUploadSessionSchema,
} from '@context-reader/contracts';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { readBoundedMultipartStream } from '../../http/stream';
import { parseUuidParam, requireIdempotencyKey } from '../../http/validation';
import { requireAuth } from '../auth/routes';
import { parseBearerToken } from '../auth/token';
import { detectImportFile } from '../imports/extractors/document';
import { ClaimAttemptLimiter } from './claim-limiter';
import { normalizeUploadCode } from './code';
import {
  renderBrowserErrorPage,
  renderCodePage,
  renderDonePage,
  renderUploadPage,
  type BrowserErrorKind,
} from './page';
import {
  claimComputerUploadSession,
  consumeComputerUpload,
  createComputerUploadSession,
  getComputerUploadSessionForUser,
} from './service';

const browserHeaders = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'text/html; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

const ClaimBodySchema = z.object({ code: z.string().max(32) }).strict();
const EmptyBodySchema = z.object({}).strict();

export interface ComputerUploadRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export const computerUploadRoutes: FastifyPluginAsync<
  ComputerUploadRoutesOptions
> = async (app, options) => {
  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      fileSize: options.config.IMPORT_MAX_FILE_BYTES,
    },
  });
  const limiter = new ClaimAttemptLimiter();

  app.post(
    '/v1/computer-upload-sessions',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const body = EmptyBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        throw new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
      }
      const installationToken = parseBearerToken(
        request.headers.authorization,
      );
      const created = await createComputerUploadSession(options.db, {
        userId: request.authUser.userId,
        installationToken,
        idempotencyKey,
        publicServerOrigin: options.config.publicServerOrigin,
        ttlMs: options.config.COMPUTER_UPLOAD_TTL_MS,
        draftTtlMs: options.config.IMPORT_DRAFT_TTL_MS,
      });
      return reply
        .status(201)
        .send(CreatedComputerUploadSessionSchema.parse(created));
    },
  );

  app.get(
    '/v1/computer-upload-sessions/:id',
    { preHandler: requireAuth(options.db) },
    async (request) => {
      const sessionId = parseUuidParam(
        request.params,
        'id',
        '上传会话编号格式无效',
      );
      const session = await getComputerUploadSessionForUser(options.db, {
        userId: request.authUser.userId,
        sessionId,
      });
      return ComputerUploadSessionDtoSchema.parse(session);
    },
  );

  app.get(
    '/computer-upload',
    { config: { cors: { origin: false } } },
    async (_request, reply) => sendPage(reply, renderCodePage()),
  );

  app.post(
    '/computer-upload/claim',
    { config: { cors: { origin: false } } },
    async (request, reply) => {
      try {
        assertBrowserPostOrigin(request, options.config);
        const ipKey = `ip:${createHash('sha256').update(request.ip, 'utf8').digest('hex')}`;
        const parsed = ClaimBodySchema.safeParse(request.body);
        if (!parsed.success) {
          limiter.assertAllowed([ipKey]);
          limiter.recordFailure([ipKey]);
          throw invalidCode();
        }
        let normalizedCode: string;
        try {
          normalizedCode = normalizeUploadCode(parsed.data.code);
        } catch (error) {
          limiter.assertAllowed([ipKey]);
          limiter.recordFailure([ipKey]);
          throw error;
        }
        const keys = claimKeys(ipKey, normalizedCode);
        limiter.assertAllowed(keys);
        let claimed: Awaited<ReturnType<typeof claimComputerUploadSession>>;
        try {
          claimed = await claimComputerUploadSession(options.db, {
            normalizedCode,
            now: new Date(),
          });
        } catch (error) {
          limiter.recordFailure(keys);
          throw error;
        }
        reply.setCookie('cr_upload', claimed.capabilityToken, {
          httpOnly: true,
          sameSite: 'strict',
          secure:
            new URL(options.config.publicServerOrigin).protocol === 'https:',
          path: '/computer-upload',
          expires: claimed.expiresAt,
        });
        return sendPage(reply, renderUploadPage());
      } catch (error) {
        return sendErrorPage(reply, error);
      }
    },
  );

  app.post(
    '/computer-upload/file',
    { config: { cors: { origin: false } } },
    async (request, reply) => {
      try {
        assertBrowserPostOrigin(request, options.config);
        const capabilityToken = request.cookies['cr_upload'];
        if (!capabilityToken) {
          throw new AppError('UPLOAD_SESSION_USED', '上传会话已被使用', 410);
        }
        const stored = await readSingleUploadPart(
          request,
          app.multipartErrors,
          options.config.IMPORT_MAX_FILE_BYTES,
        );
        await detectImportFile(stored.content, stored.mediaType);
        await consumeComputerUpload(options.db, {
          capabilityToken,
          mediaType: stored.mediaType,
          content: stored.content,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          jobDeadlineMs: options.config.IMPORT_JOB_DEADLINE_MS,
          now: new Date(),
        });
        reply.clearCookie('cr_upload', { path: '/computer-upload' });
        return sendPage(reply, renderDonePage());
      } catch (error) {
        return sendErrorPage(reply, error);
      }
    },
  );
};

function claimKeys(ipKey: string, normalizedCode: string): string[] {
  const codeHash = createHash('sha256')
    .update(normalizedCode, 'utf8')
    .digest('hex');
  return [ipKey, `code:${codeHash}`];
}

function assertBrowserPostOrigin(
  request: FastifyRequest,
  config: ServerConfig,
): void {
  const origin = request.headers.origin;
  if (origin !== undefined) {
    let canonicalOrigin: string;
    try {
      canonicalOrigin = new URL(origin).origin;
    } catch {
      throw rejectedBrowserPost();
    }
    if (canonicalOrigin !== new URL(config.publicServerOrigin).origin) {
      throw rejectedBrowserPost();
    }
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (
    fetchSite !== undefined &&
    !['none', 'same-origin'].includes(String(fetchSite))
  ) {
    throw rejectedBrowserPost();
  }
}

async function readSingleUploadPart(
  request: FastifyRequest,
  multipartErrors: FastifyInstance['multipartErrors'],
  maxBytes: number,
): Promise<{
  content: Buffer;
  byteSize: number;
  sha256: string;
  mediaType: string;
}> {
  let stored:
    | {
        content: Buffer;
        byteSize: number;
        sha256: string;
        mediaType: string;
      }
    | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type !== 'file' || part.fieldname !== 'file' || stored) {
        if (part.type === 'file') part.file.resume();
        throw invalidMultipart();
      }
      const result = await readBoundedMultipartStream(part.file, {
        maxBytes,
        signal: requestAbortSignal(request.raw),
      });
      if (part.file.truncated) {
        throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
      }
      stored = { ...result, mediaType: part.mimetype };
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof multipartErrors.RequestFileTooLargeError) {
      throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
    }
    throw invalidMultipart();
  }
  if (!stored) throw invalidMultipart();
  return stored;
}

function requestAbortSignal(raw: {
  aborted: boolean;
  once(event: 'aborted', listener: () => void): unknown;
}): AbortSignal {
  const controller = new AbortController();
  if (raw.aborted) controller.abort();
  else raw.once('aborted', () => controller.abort());
  return controller.signal;
}

function sendPage(reply: FastifyReply, page: string): FastifyReply {
  return reply.headers(browserHeaders).status(200).send(page);
}

function sendErrorPage(reply: FastifyReply, error: unknown): FastifyReply {
  const kind = errorKind(error);
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  return reply
    .headers(browserHeaders)
    .status(statusCode)
    .send(renderBrowserErrorPage(kind));
}

function errorKind(error: unknown): BrowserErrorKind {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'RATE_LIMITED':
        return 'too_many_attempts';
      case 'IMPORT_TOO_LARGE':
        return 'too_large';
      case 'IMPORT_UNSUPPORTED_TYPE':
      case 'IMPORT_CONTENT_INVALID':
      case 'IMPORT_PARSE_FAILED':
        return 'unsupported';
      case 'UPLOAD_SESSION_USED':
        return 'already_used';
      default:
        return 'invalid_or_expired';
    }
  }
  return 'invalid_or_expired';
}

function invalidCode(): AppError {
  return new AppError('UPLOAD_SESSION_EXPIRED', '上传码无效或已过期', 410);
}

function invalidMultipart(): AppError {
  return new AppError('IMPORT_CONTENT_INVALID', '上传文件无效', 422);
}

function rejectedBrowserPost(): AppError {
  return new AppError('VALIDATION_ERROR', '请求来源无效', 403);
}

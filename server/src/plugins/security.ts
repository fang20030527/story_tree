import { createHash } from 'node:crypto';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ServerConfig } from '../config/env';
import { AppError } from '../core/errors';

export interface SecurityLimits {
  globalMax: number;
  sensitiveMax: number;
  timeWindowMs: number;
}

const defaultLimits: SecurityLimits = {
  globalMax: 600,
  sensitiveMax: 30,
  timeWindowMs: 60_000,
};

const tokenLimitedRoutes = new Set([
  'POST /v1/auth/anonymous',
  'POST /v1/practices',
  'POST /v1/practices/:id/translations',
]);

export function registerSecurity(
  app: FastifyInstance,
  config: Pick<ServerConfig, 'corsOrigins'>,
  limitOverrides: Partial<SecurityLimits> = {},
): void {
  const limits = { ...defaultLimits, ...limitOverrides };
  const allowedOrigins = new Set(config.corsOrigins);
  app.register(cors, {
    origin(origin, callback) {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(
        new AppError('UNAUTHORIZED', '请求来源不被允许', 403),
        false,
      );
    },
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
  });

  app.register(rateLimit, { global: false });

  let ipLimiter: ReturnType<FastifyInstance['createRateLimit']> | null = null;
  app.addHook('onRequest', async (request, reply) => {
    if (isHealthRequest(request)) return;
    ipLimiter ??= app.createRateLimit({
      max: limits.globalMax,
      timeWindow: limits.timeWindowMs,
      keyGenerator: (currentRequest) => currentRequest.ip,
    });
    await enforceLimit(ipLimiter, request, reply);
  });

  let sensitiveLimiter: ReturnType<FastifyInstance['createRateLimit']> | null =
    null;
  app.addHook('preHandler', async (request, reply) => {
    if (!isTokenLimitedRequest(request)) return;
    sensitiveLimiter ??= app.createRateLimit({
      max: limits.sensitiveMax,
      timeWindow: limits.timeWindowMs,
      keyGenerator: tokenBucketKey,
    });
    await enforceLimit(sensitiveLimiter, request, reply);
  });
}

function isHealthRequest(request: FastifyRequest): boolean {
  return (
    request.routeOptions.url === '/health/live' ||
    request.routeOptions.url === '/health/ready'
  );
}

function isTokenLimitedRequest(request: FastifyRequest): boolean {
  return tokenLimitedRoutes.has(
    `${request.method} ${request.routeOptions.url}`,
  );
}

function tokenBucketKey(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  const material =
    typeof authorization === 'string'
      ? authorization
      : `missing-authorization:${request.ip}`;
  return createHash('sha256').update(material).digest('hex');
}

async function enforceLimit(
  limiter: ReturnType<FastifyInstance['createRateLimit']>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await limiter(request);
  if (result.isAllowed || !result.isExceeded) return;

  const retryAfter = Math.max(1, result.ttlInSeconds);
  reply.header('retry-after', retryAfter);
  throw rateLimitedError();
}

function rateLimitedError(): AppError {
  return new AppError(
    'RATE_LIMITED',
    '请求过于频繁，请稍后重试',
    429,
    true,
  );
}

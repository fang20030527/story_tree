import {
  AnonymousAuthRequestSchema,
  AnonymousAuthResponseSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { getRemainingQuota } from '../quota/service';
import { authenticateInstallation, registerAnonymous } from './service';
import { parseBearerToken } from './token';

export interface AuthRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export function requireAuth(db: AppDatabase): preHandlerHookHandler {
  return async (request) => {
    const token = parseBearerToken(request.headers.authorization);
    request.authUser = await authenticateInstallation(db, token);
  };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  app.post('/v1/auth/anonymous', async (request, reply) => {
    const parsed = AnonymousAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', '请确认已满 14 周岁', 400);
    }

    const token = parseBearerToken(request.headers.authorization);
    const authUser = await registerAnonymous(
      options.db,
      token,
      parsed.data.ageConfirmed14Plus,
    );
    const remainingFreePractices = await getRemainingQuota(
      options.db,
      authUser.userId,
      options.config.freePracticeLimit,
    );
    const body = AnonymousAuthResponseSchema.parse({
      userId: authUser.userId,
      kind: 'guest',
      remainingFreePractices,
    });

    return reply.status(authUser.created ? 201 : 200).send(body);
  });
};

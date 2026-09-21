import { DashboardDtoSchema, VocabularyTimeZoneSchema } from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { requireAuth } from '../auth/routes';
import { getDashboard } from './service';

export interface DashboardRoutesOptions {
  config: ServerConfig;
  db: AppDatabase;
}

export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    '/v1/dashboard',
    { preHandler: requireAuth(options.db) },
    async (request, reply) => {
      const query = request.query as { timeZone?: unknown };
      let timeZone: string | undefined;
      if (query.timeZone !== undefined) {
        const parsed = VocabularyTimeZoneSchema.safeParse(query.timeZone);
        if (!parsed.success) throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
        timeZone = parsed.data;
      }
      const dashboard = await getDashboard(options.db, {
        userId: request.authUser.userId,
        freeLimit: options.config.freePracticeLimit,
        ...(timeZone ? { timeZone } : {}),
      });
      return reply.send(DashboardDtoSchema.parse(dashboard));
    },
  );
};

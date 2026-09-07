import { DashboardDtoSchema } from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import type { ServerConfig } from '../../config/env';
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
      const dashboard = await getDashboard(options.db, {
        userId: request.authUser.userId,
        freeLimit: options.config.freePracticeLimit,
      });
      return reply.send(DashboardDtoSchema.parse(dashboard));
    },
  );
};

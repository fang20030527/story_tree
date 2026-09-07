import type { FastifyPluginAsync } from 'fastify';

import { authRoutes, type AuthRoutesOptions } from './routes';

export const authPlugin: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  await app.register(authRoutes, options);
};

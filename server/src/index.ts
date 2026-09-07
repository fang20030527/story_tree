import type { FastifyInstance } from 'fastify';

import { buildApp } from './app';
import { loadConfig } from './config/env';
import { createDatabase } from './db/client';

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
let app: FastifyInstance | undefined;
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    await app?.close();
    await database.close();
    process.exitCode = 0;
  })();
  return shutdownPromise;
}

try {
  app = buildApp({
    config,
    db: database.db,
    readiness: async () => {
      await database.pool.query('select 1');
      return true;
    },
  });

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  if (app) app.log.error({ err: error }, 'Server startup failed');
  else console.error('Server startup failed');
  await shutdown();
  process.exitCode = 1;
}

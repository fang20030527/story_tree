import { buildApp } from './app';
import { loadConfig } from './config/env';

const config = loadConfig(process.env);
const app = buildApp({ logLevel: config.LOG_LEVEL });

let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    await app.close();
    process.exitCode = 0;
  })();
  return shutdownPromise;
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ err: error }, 'Server startup failed');
  await shutdown();
  process.exitCode = 1;
}

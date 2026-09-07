import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { buildApp } from './app';
import { loadConfig } from './config/env';
import { createDatabase } from './db/client';
import { EvolinkClient } from './infrastructure/ai/evolink-client';
import { EvolinkAiProvider } from './infrastructure/ai/evolink-provider';
import {
  assertJobRegistrations,
  startJobRunner,
} from './modules/jobs/runner';
import type {
  JobKind,
  JobRegistration,
} from './modules/jobs/types';
import {
  failPracticeGeneration,
  handlePracticeGeneration,
} from './modules/practice/generation-handler';
import {
  failTranslation,
  handleTranslation,
} from './modules/translation/handler';

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const aiProvider = new EvolinkAiProvider(
  new EvolinkClient({
    apiKey: config.EVOLINK_API_KEY,
    baseUrl: config.EVOLINK_BASE_URL,
    textModel: config.EVOLINK_TEXT_MODEL,
    moderationModel: config.EVOLINK_MODERATION_MODEL,
    timeoutMs: config.EVOLINK_TIMEOUT_MS,
  }),
);
const generationDependencies = {
  db: database.db,
  provider: aiProvider,
  modelName: config.EVOLINK_TEXT_MODEL,
};
const translationDependencies = {
  db: database.db,
  provider: aiProvider,
};
const enabledKinds = ['practice_generation', 'translation'] as const;
const registrations = {
  practice_generation: {
    handle: (job, context) =>
      handlePracticeGeneration(generationDependencies, job, context),
    onPermanentFailure: (job, error, context) =>
      failPracticeGeneration(generationDependencies, job, error, context),
  },
  translation: {
    handle: (job, context) =>
      handleTranslation(translationDependencies, job, context),
    onPermanentFailure: (job, error, context) =>
      failTranslation(translationDependencies, job, error, context),
  },
} satisfies Partial<Record<JobKind, JobRegistration>>;
assertJobRegistrations(enabledKinds, registrations);

let app: FastifyInstance | undefined;
let worker: { stop(): Promise<void> } | undefined;
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    await worker?.stop();
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
  await database.pool.query('select 1');
  worker = startJobRunner({
    db: database.db,
    workerId: randomUUID(),
    leaseMs: config.JOB_LEASE_MS,
    pollIntervalMs: config.JOB_POLL_INTERVAL_MS,
    enabledKinds,
    registrations,
  });
} catch (error) {
  if (app) app.log.error({ err: error }, 'Server startup failed');
  else console.error('Server startup failed');
  await shutdown();
  process.exitCode = 1;
}

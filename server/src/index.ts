import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { QueryConfig } from 'pg';

import { buildApp } from './app';
import { loadConfig } from './config/env';
import { createDatabase } from './db/client';
import { EvolinkClient } from './infrastructure/ai/evolink-client';
import { EvolinkAiProvider } from './infrastructure/ai/evolink-provider';
import {
  failArticleTranslation,
  handleArticleTranslation,
} from './modules/article-translation/handler';
import {
  assertJobRegistrations,
  startJobRunner,
} from './modules/jobs/runner';
import { jobKinds } from './modules/jobs/types';
import type {
  JobKind,
  JobRegistration,
} from './modules/jobs/types';
import {
  failArticleImport,
  handleArticleImport,
} from './modules/imports/handler';
import { sweepImportCleanup } from './modules/imports/cleanup';
import { startImportCleanupRunner } from './modules/imports/cleanup-runner';
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
  {
    visionModel: config.EVOLINK_VISION_MODEL,
    visionTimeoutMs: config.EVOLINK_VISION_TIMEOUT_MS,
  },
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
const articleTranslationDependencies = {
  db: database.db,
  provider: aiProvider,
};
const articleImportDependencies = {
  db: database.db,
  fetchMaxBytes: config.IMPORT_FETCH_MAX_BYTES,
  fetchTimeoutMs: config.IMPORT_FETCH_TIMEOUT_MS,
  provider: aiProvider,
};
const enabledKinds = jobKinds;
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
  article_translation: {
    handle: (job, context) =>
      handleArticleTranslation(articleTranslationDependencies, job, context),
    onPermanentFailure: (job, error, context) =>
      failArticleTranslation(
        articleTranslationDependencies,
        job,
        error,
        context,
      ),
  },
  article_import: {
    handle: (job, context) =>
      handleArticleImport(articleImportDependencies, job, context),
    onPermanentFailure: (job, error, context) =>
      failArticleImport(articleImportDependencies, job, error, context),
  },
} satisfies Record<JobKind, JobRegistration>;
assertJobRegistrations(enabledKinds, registrations);

const readinessTimeoutMs = 2_000;
type TimedQueryConfig = QueryConfig & { query_timeout: number };

async function checkDatabaseReadiness(): Promise<boolean> {
  const query: TimedQueryConfig = {
    text: 'select 1',
    query_timeout: readinessTimeoutMs,
  };
  await database.pool.query(query);
  return true;
}

let app: FastifyInstance | undefined;
let cleanup: { stop(): Promise<void> } | undefined;
let worker: { stop(): Promise<void> } | undefined;
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    await cleanup?.stop();
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
    wordTranslationProvider: aiProvider,
    readiness: checkDatabaseReadiness,
    readinessTimeoutMs,
  });

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
  await checkDatabaseReadiness();
  cleanup = startImportCleanupRunner({
    sweep: () =>
      sweepImportCleanup(database.db, {
        now: new Date(),
        assetTtlMs: config.IMPORT_ASSET_TTL_MS,
      }),
  });
  worker = startJobRunner({
    db: database.db,
    workerId: randomUUID(),
    leaseMs: config.JOB_LEASE_MS,
    pollIntervalMs: config.JOB_POLL_INTERVAL_MS,
    enabledKinds,
    registrations,
  });
} catch {
  if (app) app.log.error({ errorType: 'StartupError' }, 'Server startup failed');
  else console.error('Server startup failed');
  await shutdown();
  process.exitCode = 1;
}

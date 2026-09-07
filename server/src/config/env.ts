import { z } from 'zod';

const RawEnvSchema = z.object({
  DATABASE_URL: z.url(),
  EVOLINK_API_KEY: z.string().min(1),
  EVOLINK_BASE_URL: z.url().default('https://direct.evolink.ai/v1'),
  EVOLINK_TEXT_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  EVOLINK_MODERATION_MODEL: z.string().min(1).default('evolink-moderation-1.0'),
  EVOLINK_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  FREE_PRACTICE_LIMIT: z.coerce.number().int().positive().default(3),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  JOB_LEASE_MS: z.coerce.number().int().positive().default(30_000),
  GENERATION_DEADLINE_MS: z.coerce.number().int().positive().default(120_000),
});

export function loadConfig(source: Record<string, string | undefined>) {
  const result = RawEnvSchema.safeParse(source);

  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ];
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }

  return {
    ...result.data,
    corsOrigins: result.data.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    freePracticeLimit: result.data.FREE_PRACTICE_LIMIT,
    generationDeadlineMs: result.data.GENERATION_DEADLINE_MS,
  };
}

export type ServerConfig = ReturnType<typeof loadConfig>;

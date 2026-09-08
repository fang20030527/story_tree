import { z } from 'zod';

const RawEnvSchema = z.object({
  DATABASE_URL: z.url(),
  EVOLINK_API_KEY: z.string().min(1),
  PUBLIC_SERVER_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  }, '必须是不含路径的 HTTP(S) origin'),
  EVOLINK_BASE_URL: z.url().default('https://direct.evolink.ai/v1'),
  EVOLINK_TEXT_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  EVOLINK_MODERATION_MODEL: z.string().min(1).default('evolink-moderation-1.0'),
  EVOLINK_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  EVOLINK_VISION_MODEL: z
    .string()
    .min(1)
    .default('deepseek-v4-flash-vision-exp'),
  EVOLINK_VISION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(120_000),
  IMPORT_MAX_TEXT_BYTES: z.coerce.number().int().positive().default(131_072),
  IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10_485_760),
  IMPORT_MAX_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(31_457_280),
  IMPORT_FETCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5_242_880),
  IMPORT_FETCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),
  IMPORT_JOB_DEADLINE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300_000),
  COMPUTER_UPLOAD_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(600_000),
  IMPORT_ASSET_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(86_400_000),
  IMPORT_DRAFT_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(604_800_000),
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
    publicServerOrigin: result.data.PUBLIC_SERVER_ORIGIN.replace(/\/$/u, ''),
    corsOrigins: result.data.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    freePracticeLimit: result.data.FREE_PRACTICE_LIMIT,
    generationDeadlineMs: result.data.GENERATION_DEADLINE_MS,
  };
}

export type ServerConfig = ReturnType<typeof loadConfig>;

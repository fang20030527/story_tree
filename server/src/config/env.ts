import { z } from 'zod';

const HttpOriginSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}, '必须是不含路径的 HTTP(S) origin');

const RawEnvSchema = z.object({
  DATABASE_URL: z.url(),
  EVOLINK_API_KEY: z.string().min(1),
  PUBLIC_SERVER_ORIGIN: HttpOriginSchema,
  EVOLINK_BASE_URL: z.url().default('https://direct.evolink.ai/v1'),
  EVOLINK_TEXT_MODEL: z.string().min(1).default('gpt-6-luna'),
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
  WECHAT_APP_ID: z.string().trim().optional().default(''),
  WECHAT_APP_SECRET: z.string().trim().optional().default(''),
  WECHAT_API_BASE_URL: z.url().default('https://api.weixin.qq.com'),
  WECHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  RESEND_API_KEY: z.string().trim().optional().default(''),
  PASSWORD_RESET_FROM_EMAIL: z.union([z.email(), z.literal('')]).default(''),
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
  EDITORIAL_AUDIO_ROOT: z.string().trim().default(''),
  SPEAKING_STORAGE_DRIVER: z.enum(['local', 'r2', 'disabled']).default('local'),
  SPEAKING_MEDIA_ROOT: z.string().trim().default('.local-media/speaking'),
  SPEAKING_MAX_MEDIA_BYTES: z.coerce.number().int().positive().max(3 * 1024 ** 3).default(3 * 1024 ** 3),
  SPEAKING_USER_STORAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 ** 3),
  SPEAKING_UPLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(1_200_000),
  SPEAKING_ASSET_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
  SPEAKING_PLAYBACK_SIGNING_KEY: z.string().trim().default(''),
  FFMPEG_PATH: z.string().trim().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().trim().min(1).default('ffprobe'),
  R2_ACCOUNT_ID: z.union([z.string().regex(/^[a-fA-F0-9]{32}$/u), z.literal('')]).default(''),
  R2_ACCESS_KEY_ID: z.string().trim().default(''),
  R2_SECRET_ACCESS_KEY: z.string().trim().default(''),
  R2_BUCKET_NAME: z.string().trim().default(''),
  EDITORIAL_AUDIO_PUBLIC_ORIGIN: z.union([HttpOriginSchema, z.literal('')]).default(''),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  FREE_PRACTICE_LIMIT: z.coerce.number().int().positive().default(3),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  JOB_LEASE_MS: z.coerce.number().int().positive().default(30_000),
  GENERATION_DEADLINE_MS: z.coerce.number().int().positive().default(120_000),
}).superRefine((value, context) => {
  if (value.SPEAKING_PLAYBACK_SIGNING_KEY && value.SPEAKING_PLAYBACK_SIGNING_KEY.length < 32) {
    context.addIssue({ code: 'custom', path: ['SPEAKING_PLAYBACK_SIGNING_KEY'], message: '播放签名密钥至少 32 字符' });
  }
  if (value.SPEAKING_STORAGE_DRIVER === 'r2') {
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'] as const) {
      if (!value[name]) context.addIssue({ code: 'custom', path: [name], message: 'R2 存储需要配置此变量' });
    }
  }
  if (value.RESEND_API_KEY && !value.PASSWORD_RESET_FROM_EMAIL) {
    context.addIssue({ code: 'custom', path: ['PASSWORD_RESET_FROM_EMAIL'], message: '必须配置发件邮箱' });
  }
  if (value.PASSWORD_RESET_FROM_EMAIL && !value.RESEND_API_KEY) {
    context.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: '必须配置邮件 API key' });
  }
});

export function loadConfig(source: Record<string, string | undefined>) {
  const result = RawEnvSchema.safeParse(withPlatformDefaults(source));

  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ];
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }

  return {
    ...result.data,
    publicServerOrigin: result.data.PUBLIC_SERVER_ORIGIN.replace(/\/$/u, ''),
    editorialAudioRoot: result.data.EDITORIAL_AUDIO_ROOT || undefined,
    editorialAudioPublicOrigin: result.data.EDITORIAL_AUDIO_PUBLIC_ORIGIN.replace(/\/$/u, '') || undefined,
    corsOrigins: result.data.CORS_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    freePracticeLimit: result.data.FREE_PRACTICE_LIMIT,
    generationDeadlineMs: result.data.GENERATION_DEADLINE_MS,
  };
}

export type ServerConfig = ReturnType<typeof loadConfig>;

function withPlatformDefaults(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (source.NODE_ENV === 'production' && !source.SPEAKING_STORAGE_DRIVER) {
    source = { ...source, SPEAKING_STORAGE_DRIVER: 'disabled' };
  }
  const explicitOrigin = source.PUBLIC_SERVER_ORIGIN?.trim();
  if (explicitOrigin) return source;

  const renderOrigin = source.RENDER_EXTERNAL_URL?.trim();
  if (!renderOrigin) return source;

  return { ...source, PUBLIC_SERVER_ORIGIN: renderOrigin };
}

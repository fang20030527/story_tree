import type {
  ImagesBinding,
  MarkdownBinding,
} from './imports/convert';
import type { CpuBoundaryNamespace } from './cpu/types';
import { AppError } from '../../../server/src/core/errors';

// These small interfaces describe only the binding operations needed by the
// migration. Replace or extend them with Wrangler-generated types as modules
// begin using each resource.
export interface D1StatementBinding {
  bind(...values: unknown[]): D1StatementBinding;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1StatementBinding;
  batch(statements: D1StatementBinding[]): Promise<unknown[]>;
}

export interface R2BucketBinding {
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string,
    options?: { sha256: ArrayBuffer; httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    objects: Array<{ key: string; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface SpeakingR2ObjectMetadata {
  size: number;
  etag: string;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

export interface SpeakingR2BucketBinding {
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<(SpeakingR2ObjectMetadata & { body: ReadableStream<Uint8Array> }) | null>;
  head(key: string): Promise<SpeakingR2ObjectMetadata | null>;
  delete(key: string | string[]): Promise<void>;
}

export interface JobQueueMessage {
  jobId: string;
}

export interface QueueBinding<T> {
  send(message: T): Promise<void>;
}

export interface AiBinding extends MarkdownBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface ApiEnv {
  DB: D1DatabaseBinding;
  IMPORT_BUCKET: R2BucketBinding;
  SPEAKING_BUCKET?: SpeakingR2BucketBinding;
  IMAGE_SERVICE?: { fetch(request: Request): Promise<Response> };
  JOB_QUEUE?: QueueBinding<JobQueueMessage>;
  AI: AiBinding;
  IMAGES: ImagesBinding;
  // Deliberately optional until the free-plan CPU boundary is verified.
  CPU_BOUNDARY?: CpuBoundaryNamespace;

  EVOLINK_API_KEY?: string;
  EVOLINK_BASE_URL?: string;
  EVOLINK_TEXT_MODEL?: string;
  EVOLINK_TIMEOUT_MS?: string;
  EVOLINK_VISION_MODEL?: string;
  EVOLINK_VISION_TIMEOUT_MS?: string;
  SPEECHACE_API_KEY?: string;
  SPEECHACE_REGION?: string;
  SPEECHACE_TIMEOUT_MS?: string;
  SPEECHACE_DAILY_LIMIT?: string;
  GENERATION_DEADLINE_MS?: string;
  RESEND_API_KEY?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  PASSWORD_RESET_FROM_EMAIL: string;
  API_CORS_ORIGINS?: string;
  API_STAGE_OPEN?: string;
}

export interface SpeechaceSettings {
  apiKey: string | undefined;
  region: 'us-west' | 'ap-southeast' | 'eu-west' | 'ap-south';
  timeoutMs: number;
  dailyLimit: number;
}

/** 区域只能映射至官方端点；错误只包含变量名，绝不包含配置值。 */
export function getSpeechaceSettings(env: ApiEnv): SpeechaceSettings {
  const region = env.SPEECHACE_REGION ?? 'ap-southeast';
  if (!['us-west', 'ap-southeast', 'eu-west', 'ap-south'].includes(region)) {
    throw new AppError('PRONUNCIATION_NOT_CONFIGURED', '发音评分配置无效：SPEECHACE_REGION', 503);
  }
  const integer = (raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string) => {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new AppError('PRONUNCIATION_NOT_CONFIGURED', `发音评分配置无效：${name}`, 503);
    }
    return value;
  };
  return {
    apiKey: env.SPEECHACE_API_KEY?.trim() || undefined,
    region: region as SpeechaceSettings['region'],
    timeoutMs: integer(env.SPEECHACE_TIMEOUT_MS, 20_000, 1_000, 25_000, 'SPEECHACE_TIMEOUT_MS'),
    dailyLimit: integer(env.SPEECHACE_DAILY_LIMIT, 50, 1, 10_000, 'SPEECHACE_DAILY_LIMIT'),
  };
}

export function isApiConfigured(env: ApiEnv): boolean {
  return env.API_STAGE_OPEN === 'true' && !!env.JOB_QUEUE && !!env.CPU_BOUNDARY &&
    !!env.IMPORT_BUCKET && !!env.IMAGE_SERVICE && !!env.AI && !!env.IMAGES &&
    !!env.EVOLINK_API_KEY && !!env.RESEND_API_KEY &&
    !!env.PASSWORD_RESET_FROM_EMAIL;
}

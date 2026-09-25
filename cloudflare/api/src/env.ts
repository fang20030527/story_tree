import type {
  ImagesBinding,
  MarkdownBinding,
} from './imports/convert';
import type { CpuBoundaryNamespace } from './cpu/types';

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
  GENERATION_DEADLINE_MS?: string;
  RESEND_API_KEY?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  PASSWORD_RESET_FROM_EMAIL: string;
  API_CORS_ORIGINS?: string;
  API_STAGE_OPEN?: string;
}

export function isApiConfigured(env: ApiEnv): boolean {
  return env.API_STAGE_OPEN === 'true' && !!env.JOB_QUEUE && !!env.CPU_BOUNDARY &&
    !!env.IMPORT_BUCKET && !!env.IMAGE_SERVICE && !!env.AI && !!env.IMAGES &&
    !!env.EVOLINK_API_KEY && !!env.RESEND_API_KEY &&
    !!env.PASSWORD_RESET_FROM_EMAIL;
}

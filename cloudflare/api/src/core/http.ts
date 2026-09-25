import { AppError, errorCodes } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';
import { RateLimitError } from './rate-limit';

const knownCodes = new Set<string>(errorCodes);
const MAX_JSON_BYTES = 32 * 1024;

function allowedOrigin(request: Request, env: ApiEnv, strict = false): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowed = new Set((env.API_CORS_ORIGINS ?? '')
    .split(',').map((item) => item.trim()).filter(Boolean));
  if (origin === new URL(request.url).origin || allowed.has(origin)) return origin;
  if (strict) throw new AppError('UNAUTHORIZED', '请求来源不被允许', 403);
  return null;
}

export function assertAllowedOrigin(request: Request, env: ApiEnv): void {
  allowedOrigin(request, env, true);
}

export function addCommonHeaders(
  response: Response,
  request: Request,
  env: ApiEnv,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  headers.set('x-content-type-options', 'nosniff');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
    headers.set('access-control-expose-headers', 'Retry-After, X-Request-Id');
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflight(request: Request, env: ApiEnv): Response {
  const origin = allowedOrigin(request, env, true);
  if (!origin) throw new AppError('UNAUTHORIZED', '请求来源不被允许', 403);
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
      'access-control-max-age': '86400',
      vary: 'Origin',
      'cache-control': 'no-store',
    },
  });
}

export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/iu.test(request.headers.get('content-type') ?? '')) {
    throw new AppError('VALIDATION_ERROR', '请使用 JSON 请求内容', 400);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new AppError('VALIDATION_ERROR', '请求内容过大', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
  }
}

export function publicError(error: unknown, requestId: string): Response {
  let appError: Pick<AppError, 'code' | 'message' | 'statusCode' | 'retryable'>;
  if (error instanceof AppError) {
    appError = error;
  } else if (isShapedAppError(error)) {
    appError = error;
  } else {
    appError = new AppError('INTERNAL_ERROR', '服务暂时无法完成请求', 500, true);
    const code = (error as { code?: unknown } | null)?.code;
    console.error({ errorType: 'UnexpectedError', errorCode: typeof code === 'string' && knownCodes.has(code) ? code : 'UNCLASSIFIED' });
  }
  const headers = new Headers();
  if (error instanceof RateLimitError) {
    headers.set('retry-after', String(error.retryAfterSeconds));
  }
  return Response.json({
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      retryable: appError.retryable,
    },
  }, { status: appError.statusCode, headers });
}

function isShapedAppError(error: unknown): error is AppError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Partial<AppError>;
  return typeof candidate.code === 'string' && knownCodes.has(candidate.code) &&
    typeof candidate.message === 'string' && Number.isInteger(candidate.statusCode) &&
    candidate.statusCode! >= 400 && candidate.statusCode! <= 599 &&
    typeof candidate.retryable === 'boolean';
}

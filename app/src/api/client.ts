import { PublicErrorSchema } from '@context-reader/contracts';
import Constants from 'expo-constants';
import type { ZodType } from 'zod';

import { getInstallationToken } from './installation';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromUnknown(input: unknown): ApiError {
    const parsed = PublicErrorSchema.safeParse(input);
    if (!parsed.success) {
      return new ApiError(
        'INVALID_SERVER_RESPONSE',
        '服务返回了无法识别的数据',
        true,
      );
    }

    const { code, message, requestId, retryable } = parsed.data.error;
    return new ApiError(code, message, retryable, requestId);
  }
}

const DEFAULT_API_PORT = '3000';
export const API_REQUEST_TIMEOUT_MS = 30_000;

// Bound the whole operation, including credentials and response-body reads.
// Some native/network failures never reject fetch, even after aborting it.
async function withRequestDeadline<T>(
  init: RequestInit,
  operation: (request: RequestInit) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError('REQUEST_TIMEOUT', '连接超时，服务可能正在启动，请稍后重试', true));
      controller.abort();
    }, API_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation({ ...init, signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export function getApiBaseUrl(): string {
  const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (!configuredBaseUrl) {
    throw new ApiError('API_NOT_CONFIGURED', '尚未配置服务地址', false);
  }
  return resolveDevelopmentLanBaseUrl(configuredBaseUrl) ?? configuredBaseUrl;
}

/**
 * Expo Go exposes the packager host at runtime. When a local API URL was
 * configured with yesterday's LAN address, use that same current host for
 * the API port so changing Wi-Fi does not strand the bookshelf behind a
 * stale, unreachable address. Deployed/remote API origins are left alone.
 */
function resolveDevelopmentLanBaseUrl(configuredBaseUrl: string): string | null {
  let configured: URL;
  try {
    configured = new URL(configuredBaseUrl);
  } catch {
    return null;
  }
  if (configured.protocol !== 'http:' && configured.protocol !== 'https:') {
    return null;
  }
  if (!isLocalHost(configured.hostname)) return null;

  const hostUri = Constants.expoConfig?.hostUri;
  if (typeof hostUri !== 'string' || !hostUri.trim()) return null;

  let runtimeHost: string;
  try {
    runtimeHost = normalizeHost(new URL(`http://${hostUri}`).hostname);
  } catch {
    return null;
  }
  if (!runtimeHost || !isLocalHost(runtimeHost)) return null;

  const port = configured.port || DEFAULT_API_PORT;
  const host = runtimeHost.includes(':') ? `[${runtimeHost}]` : runtimeHost;
  return `${configured.protocol}//${host}:${port}`;
}

function isLocalHost(hostname: string): boolean {
  const normalized = normalizeHost(hostname);
  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
  ) {
    return true;
  }

  const octets = normalized.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, '').toLowerCase();
}

function invalidServerResponse(): ApiError {
  return new ApiError(
    'INVALID_SERVER_RESPONSE',
    '服务返回了无法识别的数据',
    true,
  );
}

async function sendRequest(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError('NETWORK_ERROR', '网络连接失败', true);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidServerResponse();
  }
}

async function sendAuthenticatedRequest(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; token: string }> {
  const baseUrl = getApiBaseUrl();
  const token = await getInstallationToken();
  if (init.signal?.aborted) throw new ApiError('NETWORK_ERROR', '网络连接失败', true);
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  const response = await sendRequest(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  return { response, token };
}

async function throwPublicResponseError(
  response: Response,
  token: string,
): Promise<never> {
  let error: ApiError;
  try {
    error = ApiError.fromUnknown(await readJson(response));
  } catch {
    error = invalidServerResponse();
  }
  // Proxies may return HTML instead of our JSON error envelope.
  if (error.code === 'INVALID_SERVER_RESPONSE') {
    if (response.status >= 500) {
      error = new ApiError('SERVER_UNAVAILABLE', '服务暂时不可用，请稍后重试', true);
    } else if (response.status === 429) {
      error = new ApiError('RATE_LIMITED', '请求过于频繁，请稍后重试', true);
    }
  }
  throw redactApiError(error, token);
}

function redactApiError(error: ApiError, secret: string): ApiError {
  if (!secret || !error.message.includes(secret)) return error;
  return new ApiError(
    error.code,
    error.message.split(secret).join('[REDACTED]'),
    error.retryable,
    error.requestId,
  );
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  return withRequestDeadline(init, async (request) => {
    const { response, token } = await sendAuthenticatedRequest(path, request);
    if (!response.ok) return throwPublicResponseError(response, token);
    const json = await readJson(response);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw invalidServerResponse();
    return parsed.data;
  });
}

export async function apiRequestNoContent(
  path: string,
  init: RequestInit = {},
): Promise<void> {
  return withRequestDeadline(init, async (request) => {
    const { response, token } = await sendAuthenticatedRequest(path, request);
    if (!response.ok) return throwPublicResponseError(response, token);
    if (response.status !== 204) throw invalidServerResponse();
  });
}

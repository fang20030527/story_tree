import { PublicErrorSchema } from '@context-reader/contracts';
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

function getApiBaseUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    throw new ApiError('API_NOT_CONFIGURED', '尚未配置服务地址', false);
  }
  return baseUrl;
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
  const baseUrl = getApiBaseUrl();
  const token = await getInstallationToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  const response = await sendRequest(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const json = await readJson(response);
  if (!response.ok) {
    throw redactApiError(ApiError.fromUnknown(json), token);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalidServerResponse();
  return parsed.data;
}

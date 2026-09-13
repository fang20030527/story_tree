import {
  ArticleImportDtoSchema,
  ArticleTranslationDtoSchema,
  ComputerUploadSessionDtoSchema,
  CreatedComputerUploadSessionSchema,
  type ArticleImportDto,
  type ArticleTranslationDto,
  type ComputerUploadSessionDto,
  type ConfirmArticleImportRequest,
  type CreateArticleImportRequest,
  type CreatedComputerUploadSession,
  type TranslationRequest,
} from '@context-reader/contracts';
import { File, Paths, UploadType } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { ZodType } from 'zod';

import { ApiError, apiRequest, getApiBaseUrl } from './client';
import { getInstallationToken } from './installation';

function postIdempotentJson<T>(
  path: string,
  schema: ZodType<T>,
  body: unknown,
  idempotencyKey: string,
): Promise<T> {
  return apiRequest(path, schema, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
}

export function createArticleImport(
  request: CreateArticleImportRequest,
  idempotencyKey: string,
): Promise<ArticleImportDto> {
  return postIdempotentJson(
    '/v1/imports',
    ArticleImportDtoSchema,
    request,
    idempotencyKey,
  );
}

export function getArticleImport(importId: string): Promise<ArticleImportDto> {
  return apiRequest(
    `/v1/imports/${encodeURIComponent(importId)}`,
    ArticleImportDtoSchema,
  );
}

export async function putPastedSource(
  importId: string,
  content: string,
  idempotencyKey: string,
): Promise<ArticleImportDto> {
  return withTemporaryTextFile(content, async (file) =>
    uploadFile(
      `/v1/imports/${encodeURIComponent(importId)}/source-text`,
      file,
      'text/plain; charset=utf-8',
      idempotencyKey,
      ArticleImportDtoSchema,
    ));
}

export function uploadImportAsset(
  importId: string,
  position: number,
  fileUri: string,
  mediaType: string,
  byteSize: number,
): Promise<ArticleImportDto> {
  return uploadFile(
    `/v1/imports/${encodeURIComponent(importId)}/assets/${position}`,
    new File(fileUri),
    mediaType,
    undefined,
    ArticleImportDtoSchema,
    byteSize,
  );
}

export function startArticleImport(
  importId: string,
  idempotencyKey: string,
): Promise<ArticleImportDto> {
  return postIdempotentJson(
    `/v1/imports/${encodeURIComponent(importId)}/process`,
    ArticleImportDtoSchema,
    {},
    idempotencyKey,
  );
}

export function retryArticleImport(
  importId: string,
  idempotencyKey: string,
): Promise<ArticleImportDto> {
  return postIdempotentJson(
    `/v1/imports/${encodeURIComponent(importId)}/retry`,
    ArticleImportDtoSchema,
    {},
    idempotencyKey,
  );
}

export function updateImportPreview(
  importId: string,
  request: { title: string; text: string },
  idempotencyKey: string,
): Promise<ArticleImportDto> {
  return apiRequest(
    `/v1/imports/${encodeURIComponent(importId)}/preview`,
    ArticleImportDtoSchema,
    {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(request),
    },
  );
}

export function confirmArticleImport(
  importId: string,
  request: ConfirmArticleImportRequest,
  idempotencyKey: string,
): Promise<ArticleImportDto> {
  return postIdempotentJson(
    `/v1/imports/${encodeURIComponent(importId)}/confirm`,
    ArticleImportDtoSchema,
    request,
    idempotencyKey,
  );
}

export function createComputerUploadSession(
  idempotencyKey: string,
): Promise<CreatedComputerUploadSession> {
  return postIdempotentJson(
    '/v1/computer-upload-sessions',
    CreatedComputerUploadSessionSchema,
    {},
    idempotencyKey,
  );
}

export function getComputerUploadSession(
  sessionId: string,
): Promise<ComputerUploadSessionDto> {
  return apiRequest(
    `/v1/computer-upload-sessions/${encodeURIComponent(sessionId)}`,
    ComputerUploadSessionDtoSchema,
  );
}

export function requestArticleTranslation(
  articleId: string,
  request: TranslationRequest,
  idempotencyKey: string,
): Promise<ArticleTranslationDto> {
  return postIdempotentJson(
    `/v1/articles/${encodeURIComponent(articleId)}/translations`,
    ArticleTranslationDtoSchema,
    request,
    idempotencyKey,
  );
}

export function getArticleTranslation(
  translationId: string,
): Promise<ArticleTranslationDto> {
  return apiRequest(
    `/v1/article-translations/${encodeURIComponent(translationId)}`,
    ArticleTranslationDtoSchema,
  );
}

async function withTemporaryTextFile<T>(
  content: string,
  operation: (file: File) => Promise<T>,
): Promise<T> {
  const file = new File(Paths.cache, `context-reader-paste-${Crypto.randomUUID()}.txt`);
  try {
    file.create({ overwrite: true });
    file.write(content);
    return await operation(file);
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // A cache cleanup failure must not hide the upload result.
    }
  }
}

async function uploadFile<T>(
  path: string,
  file: File,
  mediaType: string,
  idempotencyKey: string | undefined,
  schema: ZodType<T>,
  expectedByteSize?: number,
): Promise<T> {
  const token = await getInstallationToken();
  const byteSize = expectedByteSize ?? file.size;
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) {
    throw new ApiError('IMPORT_CONTENT_INVALID', '无法读取所选文件', false);
  }

  let result: { status: number; body: string };
  try {
    result = await file.upload(`${getApiBaseUrl()}${path}`, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mediaType,
        'Content-Length': String(byteSize),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', '网络连接失败', true);
  }

  let json: unknown;
  try {
    json = JSON.parse(result.body) as unknown;
  } catch {
    throw new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true);
  }
  if (result.status < 200 || result.status >= 300) {
    const error = ApiError.fromUnknown(json);
    if (token && error.message.includes(token)) {
      throw new ApiError(
        error.code,
        error.message.split(token).join('[REDACTED]'),
        error.retryable,
        error.requestId,
      );
    }
    throw error;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError('INVALID_SERVER_RESPONSE', '服务返回了无法识别的数据', true);
  }
  return parsed.data;
}

import {
  ArticleImportDtoSchema,
  ImportAssetDescriptorSchema,
  UuidSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';
import { putImportAsset } from './storage';

const MAX_ASSET_BYTES = 10_485_760;

interface OwnedImportRow {
  id: string;
  source_kind: string;
  status: string;
  asset_manifest_json: string | null;
  created_at: string;
  expires_at: string;
}

function parsePosition(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new AppError('VALIDATION_ERROR', '文件位置格式无效', 400);
  }
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position > 9) {
    throw new AppError('VALIDATION_ERROR', '文件位置格式无效', 400);
  }
  return position;
}

function parseContentLength(value: string | null): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new AppError('VALIDATION_ERROR', '必须提供准确的 Content-Length', 411);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new AppError('VALIDATION_ERROR', '必须提供准确的 Content-Length', 411);
  }
  return length;
}

function parseMediaType(value: string | null): string {
  if (value === null) {
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '上传文件类型不匹配', 422);
  }
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function expectedAsset(row: OwnedImportRow, position: number): {
  mediaType: string;
  byteSize: number;
} {
  let manifest: unknown;
  try {
    manifest = JSON.parse(row.asset_manifest_json ?? 'null');
  } catch {
    throw new AppError('STATE_CONFLICT', '导入清单无效', 409);
  }
  const entry = Array.isArray(manifest)
    ? manifest.find((candidate: unknown) =>
        typeof candidate === 'object' && candidate !== null &&
        'position' in candidate && candidate.position === position)
    : undefined;
  if (!entry) {
    throw new AppError('STATE_CONFLICT', '该文件位置未在导入清单中', 409);
  }
  const parsed = ImportAssetDescriptorSchema.safeParse(entry);
  if (!parsed.success) {
    throw new AppError('STATE_CONFLICT', '导入清单无效', 409);
  }
  return parsed.data;
}

async function readExactBytes(request: Request, contentLength: number): Promise<Uint8Array> {
  if (contentLength > MAX_ASSET_BYTES) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }
  const bytes = new Uint8Array(contentLength);
  const reader = request.body?.getReader();
  if (!reader) {
    throw new AppError('VALIDATION_ERROR', '上传长度与 Content-Length 不一致', 400);
  }
  let offset = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > contentLength) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    request.signal.throwIfAborted();
  } finally {
    reader.releaseLock();
  }
  if (offset !== contentLength) {
    throw new AppError('VALIDATION_ERROR', '上传长度与 Content-Length 不一致', 400);
  }
  return bytes;
}

/** Handles only the authenticated binary asset PUT route. */
export async function handleImportAssetRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'PUT') return null;
  const match = /^\/v1\/imports\/([^/]+)\/assets\/([^/]+)$/u.exec(new URL(request.url).pathname);
  if (!match) return null;

  const importId = match[1]!;
  if (!UuidSchema.safeParse(importId).success) {
    throw new AppError('VALIDATION_ERROR', '导入任务编号格式无效', 400);
  }
  const position = parsePosition(match[2]!);

  // Authorization precedes body reads and all R2 writes. A foreign ID has the
  // same response as an unknown ID, so upload routes cannot enumerate imports.
  let current: OwnedImportRow | null;
  try {
    current = await env.DB.prepare(`
      SELECT id, source_kind, status, asset_manifest_json, created_at, expires_at
      FROM article_imports WHERE id = ? AND user_id = ? LIMIT 1
    `).bind(importId, userId).first<OwnedImportRow>();
  } catch {
    throw new AppError('DATABASE_UNAVAILABLE', '数据库暂时不可用', 503, true);
  }
  if (!current) throw new AppError('NOT_FOUND', '导入任务不存在', 404);
  if (current.status !== 'awaiting_upload') {
    throw new AppError('STATE_CONFLICT', '当前导入状态不能上传文件', 409);
  }

  const expected = expectedAsset(current, position);
  const mediaType = parseMediaType(request.headers.get('content-type'));
  if (mediaType !== expected.mediaType) {
    throw new AppError('IMPORT_UNSUPPORTED_TYPE', '上传文件类型不匹配', 422);
  }
  const contentLength = parseContentLength(request.headers.get('content-length'));
  if (contentLength !== expected.byteSize) {
    throw new AppError('STATE_CONFLICT', '上传文件大小与导入清单不一致', 409);
  }

  const response = ArticleImportDtoSchema.parse({
    id: current.id,
    sourceKind: current.source_kind,
    status: current.status,
    createdAt: current.created_at,
    expiresAt: current.expires_at,
    pollAfterMs: 1_500,
    failure: null,
    preview: null,
    articleId: null,
  });
  const bytes = await readExactBytes(request, contentLength);
  // The storage module computes SHA-256 on these bytes and checks manifest,
  // duplicate positions, and aggregate size again before committing metadata.
  await putImportAsset(env, {
    articleImportId: importId,
    position,
    mediaType,
    bytes,
    declaredByteSize: contentLength,
  });
  return Response.json(response);
}

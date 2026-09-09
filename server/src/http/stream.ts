import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { AppError } from '../core/errors';

export interface ReadStreamResult {
  content: Buffer;
  byteSize: number;
  sha256: string;
}

export async function readBoundedStream(
  stream: Readable,
  input: {
    contentLength: number;
    maxBytes: number;
    signal?: AbortSignal;
  },
): Promise<ReadStreamResult> {
  if (!Number.isInteger(input.contentLength) || input.contentLength < 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      '必须提供准确的 Content-Length',
      411,
    );
  }
  if (input.contentLength > input.maxBytes) {
    throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
  }

  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const rawChunk of stream) {
    input.signal?.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteSize += chunk.byteLength;
    if (byteSize > input.maxBytes || byteSize > input.contentLength) {
      stream.destroy();
      throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
    }
    chunks.push(chunk);
    hash.update(chunk);
  }
  input.signal?.throwIfAborted();
  if (byteSize !== input.contentLength) {
    throw new AppError(
      'VALIDATION_ERROR',
      '上传长度与 Content-Length 不一致',
      400,
    );
  }
  return {
    content: Buffer.concat(chunks),
    byteSize,
    sha256: hash.digest('hex'),
  };
}

export async function readBoundedMultipartStream(
  stream: Readable,
  input: { maxBytes: number; signal?: AbortSignal },
): Promise<ReadStreamResult> {
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const rawChunk of stream) {
    input.signal?.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteSize += chunk.byteLength;
    if (byteSize > input.maxBytes) {
      stream.destroy();
      throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
    }
    chunks.push(chunk);
    hash.update(chunk);
  }
  input.signal?.throwIfAborted();
  if (byteSize === 0) {
    throw new AppError('IMPORT_CONTENT_INVALID', '上传文件为空', 422);
  }
  return {
    content: Buffer.concat(chunks),
    byteSize,
    sha256: hash.digest('hex'),
  };
}

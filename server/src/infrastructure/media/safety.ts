import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AppError } from '../../core/errors';

export function validateMediaKey(key: string): void {
  const segments = key.split('/');
  if (
    key.length === 0 ||
    key.length > 512 ||
    segments.some((segment) =>
      !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,127}$/u.test(segment) ||
      segment.endsWith('.') ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment),
    )
  ) {
    throw new AppError('VALIDATION_ERROR', '媒体资源标识无效', 400);
  }
}

export function validateContentType(contentType: string): void {
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(contentType) || contentType.length > 128) {
    throw new AppError('VALIDATION_ERROR', '媒体类型无效', 400);
  }
}

export function validateRange(range?: { start: number; end: number }): void {
  if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) {
    throw new AppError('VALIDATION_ERROR', '媒体读取范围无效', 400);
  }
}

export function assertLocalPath(path: string): string {
  if (!isAbsolute(path) || path.includes('\0') || path.startsWith('\\\\') || (process.platform === 'win32' && path.slice(2).includes(':'))) {
    throw new AppError('VALIDATION_ERROR', '媒体文件路径无效', 400);
  }
  return resolve(path);
}

export async function openLocalSource(path: string) {
  const resolved = assertLocalPath(path);
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AppError('VALIDATION_ERROR', '媒体文件无效', 400);
  }
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile()) throw new AppError('VALIDATION_ERROR', '媒体文件无效', 400);
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/** 每个目录均检查，阻止 object key 经符号链接逃逸本地存储目录。 */
export async function safeDirectory(root: string, parts: string[], create: boolean): Promise<string> {
  let directory = root;
  for (const part of parts) {
    directory = join(directory, part);
    if (create) {
      try {
        await mkdir(directory);
      } catch (error) {
        if (!hasFsCode(error, 'EEXIST')) throw error;
      }
    }
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw storageUnavailable();
    const actual = await realpath(directory);
    const child = relative(root, actual);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) throw storageUnavailable();
  }
  return directory;
}

/** 写入同目录临时文件，再原子替换；取消或失败只清理本次临时文件。 */
export async function writeReadableFile(source: Readable, path: string, signal?: AbortSignal): Promise<void> {
  let destination: string;
  try {
    destination = assertLocalPath(path);
  } catch (error) {
    source.destroy();
    throw error;
  }
  const temporary = join(dirname(destination), `.media-${randomUUID()}.tmp`);
  try {
    if (signal?.aborted) throw abortError();
    await pipeline(source, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), ...(signal ? [{ signal }] : []));
    if (signal?.aborted) throw abortError();
    try {
      const existing = await lstat(destination);
      if (existing.isSymbolicLink() || !existing.isFile()) throw storageUnavailable();
    } catch (error) {
      if (!hasFsCode(error, 'ENOENT')) throw error;
    }
    await rename(temporary, destination);
  } finally {
    source.destroy();
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function hasFsCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function abortError(): DOMException {
  return new DOMException('媒体处理已取消', 'AbortError');
}

export function storageUnavailable(): AppError {
  return new AppError('INTERNAL_ERROR', '媒体存储暂时不可用', 503, true);
}

export function sanitizedStorageError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return abortError();
  return error instanceof AppError ? error : storageUnavailable();
}

/** 下游收到稳定错误，原始流错误中的存储路径和远端请求地址不出边界。 */
export function sanitizedReadable(source: Readable): Readable {
  const output = new PassThrough();
  source.on('error', () => output.destroy(storageUnavailable()));
  output.on('close', () => source.destroy());
  source.pipe(output);
  return output;
}

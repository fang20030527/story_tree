import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import type { MediaStore } from './store';
import {
  assertLocalPath,
  hasFsCode,
  openLocalSource,
  safeDirectory,
  sanitizedStorageError,
  sanitizedReadable,
  storageUnavailable,
  validateContentType,
  validateMediaKey,
  validateRange,
  writeReadableFile,
} from './safety';

export class LocalMediaStore implements MediaStore {
  readonly driver = 'local' as const;
  private rootPromise: Promise<string> | undefined;

  constructor(private readonly localRoot: string) {
    assertLocalPath(localRoot);
  }

  async putFile(key: string, path: string, contentType: string, signal?: AbortSignal): Promise<void> {
    validateMediaKey(key);
    validateContentType(contentType);
    try {
      const destination = await this.objectPath(key, true);
      const handle = await openLocalSource(path);
      await writeReadableFile(handle.createReadStream(), destination, signal);
      const metadata = await this.metadataPath(key, true);
      await writeReadableFile(Readable.from([JSON.stringify({ contentType })]), metadata, signal);
    } catch (error) {
      throw sanitizedStorageError(error, signal);
    }
  }

  async downloadFile(key: string, path: string, signal?: AbortSignal): Promise<void> {
    validateMediaKey(key);
    assertLocalPath(path);
    try {
      await writeReadableFile(await this.openRead(key), path, signal);
    } catch (error) {
      throw sanitizedStorageError(error, signal);
    }
  }

  async stat(key: string): Promise<{ byteSize: number; contentType: string } | null> {
    validateMediaKey(key);
    try {
      const path = await this.objectPath(key);
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw storageUnavailable();
      const metadataPath = await this.metadataPath(key);
      const metadataInfo = await lstat(metadataPath);
      if (metadataInfo.isSymbolicLink() || !metadataInfo.isFile() || metadataInfo.size > 512) throw storageUnavailable();
      const metadata: unknown = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (typeof metadata !== 'object' || metadata === null || !('contentType' in metadata) || typeof metadata.contentType !== 'string') throw storageUnavailable();
      validateContentType(metadata.contentType);
      return { byteSize: info.size, contentType: metadata.contentType };
    } catch (error) {
      if (hasFsCode(error, 'ENOENT')) return null;
      throw sanitizedStorageError(error);
    }
  }

  async openRead(key: string, range?: { start: number; end: number }): Promise<Readable> {
    validateMediaKey(key);
    validateRange(range);
    try {
      const handle = await openLocalSource(await this.objectPath(key));
      return sanitizedReadable(handle.createReadStream(range ? { start: range.start, end: range.end } : undefined));
    } catch (error) {
      throw sanitizedStorageError(error);
    }
  }

  async delete(key: string): Promise<void> {
    validateMediaKey(key);
    try {
      const path = await this.objectPath(key);
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw storageUnavailable();
      await rm(path, { force: true });
      const metadataPath = await this.metadataPath(key);
      const metadataInfo = await lstat(metadataPath).catch((error: unknown) => {
        if (hasFsCode(error, 'ENOENT')) return null;
        throw error;
      });
      if (metadataInfo && (metadataInfo.isSymbolicLink() || !metadataInfo.isFile())) throw storageUnavailable();
      await rm(metadataPath, { force: true });
    } catch (error) {
      if (hasFsCode(error, 'ENOENT')) return;
      throw sanitizedStorageError(error);
    }
  }

  private async root(): Promise<string> {
    // 不在构造阶段启动可能被遗忘的拒绝 Promise。
    this.rootPromise ??= (async () => {
      const root = resolve(this.localRoot);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const info = await lstat(root);
      if (info.isSymbolicLink() || !info.isDirectory()) throw storageUnavailable();
      return realpath(root);
    })();
    return this.rootPromise;
  }

  private async objectPath(key: string, create = false): Promise<string> {
    const segments = key.split('/');
    const filename = segments.pop()!;
    return join(await safeDirectory(await this.root(), ['objects', ...segments], create), filename);
  }

  private async metadataPath(key: string, create = false): Promise<string> {
    const metadataRoot = await safeDirectory(await this.root(), ['metadata'], create);
    return join(metadataRoot, `${createHash('sha256').update(key).digest('hex')}.json`);
  }
}

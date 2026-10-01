import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

import { AppError } from '../../core/errors';
import type { MediaStore, MediaStoreOptions } from './store';
import {
  abortError,
  assertLocalPath,
  openLocalSource,
  sanitizedStorageError,
  sanitizedReadable,
  storageUnavailable,
  validateContentType,
  validateMediaKey,
  validateRange,
  writeReadableFile,
} from './safety';

type R2Config = Extract<MediaStoreOptions, { driver: 'r2' }>['r2'];
const controlRequestTimeoutMs = 60_000;

export class R2MediaStore implements MediaStore {
  readonly driver = 'r2' as const;
  private readonly client: S3Client;

  constructor(private readonly config: R2Config, client?: S3Client) {
    if (config.accountId.length !== 32 || !/^[a-fA-F0-9]{32}$/u.test(config.accountId) ||
      config.bucketName !== config.bucketName.trim() || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(config.bucketName) ||
      !config.accessKeyId || !config.secretAccessKey) {
      throw new AppError('VALIDATION_ERROR', 'R2 媒体存储配置不完整', 500);
    }
    this.client = client ?? new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId.toLowerCase()}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // NodeHttpHandler 在收到响应头、完成请求体发送后清除此计时器。
      // GET 的电影正文没有 60 秒总时限；PUT 的时限按每个 multipart part 生效。
      requestHandler: {
        connectionTimeout: 10_000,
        requestTimeout: controlRequestTimeoutMs,
        throwOnRequestTimeout: true,
      },
    });
  }

  async putFile(key: string, path: string, contentType: string, signal?: AbortSignal): Promise<void> {
    validateMediaKey(key);
    validateContentType(contentType);
    if (signal?.aborted) throw abortError();
    let source: Readable | undefined;
    let upload: Upload | undefined;
    const onAbort = () => {
      source?.destroy();
      void upload?.abort().catch(() => undefined);
    };
    try {
      const handle = await openLocalSource(path);
      source = handle.createReadStream();
      upload = new Upload({
        client: this.client,
        params: { Bucket: this.config.bucketName, Key: key, Body: source, ContentType: contentType },
        partSize: 8 * 1024 * 1024,
        queueSize: 2,
        leavePartsOnError: false,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      await upload.done();
      if (signal?.aborted) throw abortError();
    } catch (error) {
      throw sanitizedStorageError(error, signal);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      source?.destroy();
    }
  }

  async downloadFile(key: string, path: string, signal?: AbortSignal): Promise<void> {
    validateMediaKey(key);
    assertLocalPath(path);
    if (signal?.aborted) throw abortError();
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucketName, Key: key }), signal ? { abortSignal: signal } : {});
      if (!(result.Body instanceof Readable)) throw storageUnavailable();
      await writeReadableFile(result.Body, path, signal);
    } catch (error) {
      throw sanitizedStorageError(error, signal);
    }
  }

  async stat(key: string): Promise<{ byteSize: number; contentType: string } | null> {
    validateMediaKey(key);
    const deadline = AbortSignal.timeout(controlRequestTimeoutMs);
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucketName, Key: key }), { abortSignal: deadline });
      if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength! < 0 || !result.ContentType) throw storageUnavailable();
      validateContentType(result.ContentType);
      return { byteSize: result.ContentLength!, contentType: result.ContentType };
    } catch (error) {
      if (deadline.aborted) throw storageUnavailable();
      if (typeof error === 'object' && error !== null && 'name' in error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) return null;
      throw sanitizedStorageError(error);
    }
  }

  async openRead(key: string, range?: { start: number; end: number }): Promise<Readable> {
    validateMediaKey(key);
    validateRange(range);
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }));
      if (!(result.Body instanceof Readable)) throw storageUnavailable();
      return sanitizedReadable(result.Body);
    } catch (error) {
      throw sanitizedStorageError(error);
    }
  }

  async delete(key: string): Promise<void> {
    validateMediaKey(key);
    const deadline = AbortSignal.timeout(controlRequestTimeoutMs);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucketName, Key: key }), { abortSignal: deadline });
    } catch (error) {
      if (deadline.aborted) throw storageUnavailable();
      throw sanitizedStorageError(error);
    }
  }

  async signedReadUrl(key: string, expiresSeconds: number): Promise<string> {
    validateMediaKey(key);
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 3600) throw new AppError('VALIDATION_ERROR', '媒体链接有效期无效', 400);
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucketName, Key: key }), { expiresIn: expiresSeconds });
    } catch (error) {
      throw sanitizedStorageError(error);
    }
  }
}

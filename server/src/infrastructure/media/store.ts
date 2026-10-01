import type { Readable } from 'node:stream';

import type { S3Client } from '@aws-sdk/client-s3';

import { LocalMediaStore } from './local-store';
import { R2MediaStore } from './r2-store';

export interface MediaStore {
  readonly driver: 'local' | 'r2';
  putFile(key: string, path: string, contentType: string, signal?: AbortSignal): Promise<void>;
  downloadFile(key: string, path: string, signal?: AbortSignal): Promise<void>;
  stat(key: string): Promise<{ byteSize: number; contentType: string } | null>;
  openRead(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
  signedReadUrl?(key: string, expiresSeconds: number): Promise<string>;
}

export type MediaStoreOptions =
  | { driver: 'local'; localRoot: string }
  | {
      driver: 'r2';
      r2: {
        accountId: string;
        bucketName: string;
        accessKeyId: string;
        secretAccessKey: string;
      };
      /** 测试可注入客户端；运行时仍只使用服务端配置的 R2 endpoint。 */
      client?: S3Client;
    };

export function createMediaStore(options: MediaStoreOptions): MediaStore {
  return options.driver === 'local'
    ? new LocalMediaStore(options.localRoot)
    : new R2MediaStore(options.r2, options.client);
}

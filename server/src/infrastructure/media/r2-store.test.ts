import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { R2MediaStore } from './r2-store';

const config = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucketName: 'speaking-test',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

describe('R2 媒体存储边界', () => {
  it('仅发送合法 key 和字节范围，保持下载流', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ContentLength: 10, ContentType: 'video/mp4' }).mockResolvedValueOnce({ Body: Readable.from(['2345']) }).mockResolvedValueOnce({}).mockRejectedValueOnce({ name: 'NotFound' });
    const store = new R2MediaStore(config, { send } as unknown as S3Client);
    expect(await store.stat('user/source.mp4')).toEqual({ byteSize: 10, contentType: 'video/mp4' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    const source = await store.openRead('user/source.mp4', { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const chunk of source) chunks.push(Buffer.from(chunk as string));
    expect(Buffer.concat(chunks).toString()).toBe('2345');
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[1]?.[0] as GetObjectCommand).input).toEqual({ Bucket: config.bucketName, Key: 'user/source.mp4', Range: 'bytes=2-5' });
    await store.delete('user/source.mp4');
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(await store.stat('user/missing.mp4')).toBeNull();
  });

  it('将 R2 原始错误收敛为稳定错误，不暴露密钥', async () => {
    const send = vi.fn().mockRejectedValue(new Error(`raw ${config.secretAccessKey}`));
    const store = new R2MediaStore(config, { send } as unknown as S3Client);
    const error = await store.stat('user/source.mp4').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true });
    expect(String(error)).not.toContain(config.secretAccessKey);
    await expect(store.openRead('../source.mp4')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(store.signedReadUrl('user/source.mp4', 3601)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('R2 下载流式写入本地临时文件，取消前不发远端请求', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-tree-r2-test-'));
    try {
      const send = vi.fn().mockResolvedValue({ Body: Readable.from(['media']) });
      const store = new R2MediaStore(config, { send } as unknown as S3Client);
      const destination = join(directory, 'source.mp4');
      await store.downloadFile('user/source.mp4', destination);
      expect(await readFile(destination, 'utf8')).toBe('media');
      const signal = AbortSignal.abort();
      await expect(store.downloadFile('user/source.mp4', destination, signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      const resolved = resolve(directory);
      const child = relative(tmpdir(), resolved);
      if (child.startsWith('story-tree-r2-test-') && !child.includes('..')) await rm(resolved, { recursive: true, force: true });
    }
  });

  it('签名 URL 有期限，不需要公开 R2 bucket', async () => {
    const store = new R2MediaStore(config);
    const url = new URL(await store.signedReadUrl('user/source.mp4', 60));
    expect(url.protocol).toBe('https:');
    expect(url.hostname.endsWith('.r2.cloudflarestorage.com')).toBe(true);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.pathname).toContain('user/source.mp4');
  });

  it('接受大小写 hex accountId，签名 endpoint 使用小写', async () => {
    const store = new R2MediaStore({ ...config, accountId: config.accountId.toUpperCase() });
    const url = new URL(await store.signedReadUrl('user/source.mp4', 60));
    expect(url.hostname).toContain(config.accountId);
    expect(() => new R2MediaStore({ ...config, accountId: 'g'.repeat(32) })).toThrow('R2 媒体存储配置不完整');
  });

  it.each(['ab', 'a'.repeat(64), '-movie', 'movie-', 'Movie', 'movie.bucket', 'movie_bucket', 'movie/bucket', 'movie\n'])('拒绝 Cloudflare 不支持的 bucketName %s', (bucketName) => {
    expect(() => new R2MediaStore({ ...config, bucketName })).toThrow('R2 媒体存储配置不完整');
  });

  it('stat/delete 使用 60 秒整次请求 deadline，超时可重试并隐藏原始错误', async () => {
    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => actualTimeout(Math.min(duration, 10)));
    const send = vi.fn().mockImplementation((_command, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
      const fail = () => reject(new DOMException(`raw ${config.secretAccessKey}`, 'AbortError'));
      if (options.abortSignal.aborted) fail();
      else options.abortSignal.addEventListener('abort', fail, { once: true });
    }));
    try {
      const store = new R2MediaStore(config, { send } as unknown as S3Client);
      const errors = await Promise.all([
        store.stat('user/source.mp4').catch((error: unknown) => error),
        store.delete('user/source.mp4').catch((error: unknown) => error),
      ]);
      for (const error of errors) {
        expect(error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true });
        expect(String(error)).not.toContain(config.secretAccessKey);
      }
      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 60_000);
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, 60_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('SDK 响应头后清除 requestTimeout，电影正文可继续流式读取', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '2' });
      response.write('a');
      setTimeout(() => response.end('b'), 250);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('本地测试服务器未就绪');
    const client = new S3Client({
      region: 'auto', endpoint: `http://127.0.0.1:${address.port}`, forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      responseChecksumValidation: 'WHEN_REQUIRED', requestChecksumCalculation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 100, requestTimeout: 100, throwOnRequestTimeout: true },
    });
    try {
      const store = new R2MediaStore(config, client);
      const stream = await store.openRead('user/source.mp4');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as string));
      expect(Buffer.concat(chunks).toString()).toBe('ab');
    } finally {
      client.destroy();
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  });
});

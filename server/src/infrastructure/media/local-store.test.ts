import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalMediaStore } from './local-store';
import { sanitizedReadable, writeReadableFile } from './safety';

let directory: string;
let root: string;
let source: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'story-tree-media-test-'));
  root = join(directory, 'store');
  source = join(directory, 'source.mp4');
  await writeFile(source, Buffer.from('0123456789'));
});

afterEach(async () => {
  const resolved = resolve(directory);
  const parent = relative(tmpdir(), resolved);
  if (parent.startsWith('story-tree-media-test-') && !parent.includes('..')) await rm(resolved, { recursive: true, force: true });
});

describe('本地媒体流式存储', () => {
  it('保存元信息、按字节范围读取、下载及幂等删除', async () => {
    const store = new LocalMediaStore(root);
    expect(store.driver).toBe('local');
    expect(await store.stat('user-1/movie-1/source.mp4')).toBeNull();
    await store.putFile('user-1/movie-1/source.mp4', source, 'video/mp4');
    expect(await store.stat('user-1/movie-1/source.mp4')).toEqual({ byteSize: 10, contentType: 'video/mp4' });
    const range = await store.openRead('user-1/movie-1/source.mp4', { start: 2, end: 5 });
    expect(await consume(range)).toBe('2345');
    const destination = join(directory, 'download.mp4');
    await store.downloadFile('user-1/movie-1/source.mp4', destination);
    expect(await readFile(destination, 'utf8')).toBe('0123456789');
    await store.delete('user-1/movie-1/source.mp4');
    await store.delete('user-1/movie-1/source.mp4');
    expect(await store.stat('user-1/movie-1/source.mp4')).toBeNull();
  });

  it.each(['../movie.mp4', 'user/../../movie.mp4', '/movie.mp4', 'user\\movie.mp4', 'user//movie.mp4', 'user/%2e%2e/movie.mp4', 'user/CON.mp4', 'user/file.mp4:stream', 'user/file.'])('拒绝不安全 object key %s', async (key) => {
    const store = new LocalMediaStore(root);
    await expect(store.putFile(key, source, 'video/mp4')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await readdir(directory)).toEqual(['source.mp4']);
  });

  it('拒绝目录 junction 逃逸存储边界', async () => {
    const store = new LocalMediaStore(root);
    await store.putFile('user-1/original.mp4', source, 'video/mp4');
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'private.mp4'), 'private');
    await symlink(outside, join(root, 'objects', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(store.putFile('escape/new.mp4', source, 'video/mp4')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(store.openRead('escape/private.mp4')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await readdir(outside)).toEqual(['private.mp4']);
  });

  it('取消写入保留旧文件并清理临时文件', async () => {
    const destination = join(directory, 'existing.mp4');
    await writeFile(destination, 'previous');
    const controller = new AbortController();
    const input = new Readable({ read() { this.push(Buffer.alloc(1024)); } });
    const pending = writeReadableFile(input, destination, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readFile(destination, 'utf8')).toBe('previous');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(input.destroyed).toBe(true);
  });

  it('无效范围与缺失资源不暴露存储路径', async () => {
    const store = new LocalMediaStore(root);
    await expect(store.openRead('missing.mp4', { start: 4, end: 2 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const error = await store.openRead('missing.mp4').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(String(error)).not.toContain(directory);
    const input = new Readable({ read() { this.destroy(new Error(`sensitive ${directory}`)); } });
    const streamError = await consume(sanitizedReadable(input)).catch((value: unknown) => value);
    expect(streamError).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(String(streamError)).not.toContain(directory);
  });
});

async function consume(source: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString('utf8');
}

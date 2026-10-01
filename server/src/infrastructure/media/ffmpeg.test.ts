import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FFmpegMediaProcessor, type MediaSpawn } from './ffmpeg';

let directory: string;
let source: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'story-tree-ffmpeg-test-'));
  source = join(directory, 'movie & do-not-execute.mp4');
  await writeFile(source, 'fake-media');
});

afterEach(async () => {
  const resolved = resolve(directory);
  const child = relative(tmpdir(), resolved);
  if (child.startsWith('story-tree-ffmpeg-test-') && !child.includes('..')) await rm(resolved, { recursive: true, force: true });
});

describe('本地 FFmpeg 媒体处理', () => {
  it('解析视频 metadata，禁止网络协议和 shell', async () => {
    const fake = fakeProcess();
    const spawnImpl = vi.fn<MediaSpawn>().mockImplementation(() => {
      setImmediate(() => {
        fake.stdout.end(JSON.stringify({ format: { duration: '7200.25' }, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }));
        fake.process.emit('close', 0);
      });
      return fake.process;
    });
    const processor = new FFmpegMediaProcessor({}, spawnImpl);
    expect(await processor.probe(source)).toEqual({ durationSeconds: 7200.25, hasAudio: true, mediaType: 'video' });
    expect(spawnImpl.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file,pipe', '-format_whitelist', source]));
    expect(spawnImpl.mock.calls[0]?.[2]).toMatchObject({ shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    await expect(processor.probe('https://example.invalid/movie.mp4')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('fallback 音轨时长有效，无语音视频保留 hasAudio=false', async () => {
    const outputs = [
      { streams: [{ codec_type: 'audio', duration: '60.5' }] },
      { format: { duration: '12' }, streams: [{ codec_type: 'video' }] },
    ];
    const spawnImpl = vi.fn<MediaSpawn>().mockImplementation(() => {
      const fake = fakeProcess();
      setImmediate(() => {
        fake.stdout.end(JSON.stringify(outputs.shift()));
        fake.process.emit('close', 0);
      });
      return fake.process;
    });
    const processor = new FFmpegMediaProcessor({}, spawnImpl);
    expect(await processor.probe(source)).toEqual({ durationSeconds: 60.5, hasAudio: true, mediaType: 'audio' });
    expect(await processor.probe(source)).toEqual({ durationSeconds: 12, hasAudio: false, mediaType: 'video' });
  });

  it('取消和超时杀掉子进程，错误不带文件路径', async () => {
    const aborted = fakeProcess();
    const timedOut = fakeProcess();
    const spawnImpl = vi.fn<MediaSpawn>().mockReturnValueOnce(aborted.process).mockReturnValueOnce(timedOut.process);
    const processor = new FFmpegMediaProcessor({ timeoutMs: 200 }, spawnImpl);
    const controller = new AbortController();
    const pending = processor.probe(source, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await assertion;
    expect(aborted.kill).toHaveBeenCalledWith('SIGKILL');
    const error = await processor.probe(source).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'IMPORT_PARSE_FAILED', retryable: true });
    expect(timedOut.kill).toHaveBeenCalledWith('SIGKILL');
    expect(String(error)).not.toContain(directory);
  });

  it('限制 probe 输出大小，拒绝无效时长', async () => {
    const fake = fakeProcess();
    const spawnImpl = vi.fn<MediaSpawn>().mockImplementation(() => {
      setImmediate(() => fake.stdout.write(Buffer.alloc(65 * 1024)));
      return fake.process;
    });
    const processor = new FFmpegMediaProcessor({}, spawnImpl);
    await expect(processor.probe(source)).rejects.toMatchObject({ code: 'IMPORT_CONTENT_INVALID' });
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('片段导出为单声道 16k/32kbps MP3，不覆盖原有文件', async () => {
    const fake = fakeProcess();
    const spawnImpl = vi.fn<MediaSpawn>().mockImplementation((_binary, args) => {
      const parameters = args as string[];
      const target = parameters.at(-1)!;
      void writeFile(target, 'mp3-audio').then(() => fake.process.emit('close', 0));
      return fake.process;
    });
    const processor = new FFmpegMediaProcessor({}, spawnImpl);
    const output = join(directory, 'clip.mp3');
    await processor.extractMp3(source, output, 30.5, 15);
    const args = spawnImpl.mock.calls[0]?.[1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-ss', '30.500', '-t', '15.000', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-c:a', 'libmp3lame']));
    expect(await readFile(output, 'utf8')).toBe('mp3-audio');
    await expect(processor.extractMp3(source, output, 0, 10)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await readFile(output, 'utf8')).toBe('mp3-audio');
    expect((await readdir(directory)).filter((name) => name.startsWith('.audio-'))).toEqual([]);
  });
});

function fakeProcess() {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const kill = vi.fn().mockImplementation(() => {
    setImmediate(() => events.emit('close', null));
    return true;
  });
  return { stdout, kill, process: Object.assign(events, { stdout, kill }) as unknown as ChildProcess };
}

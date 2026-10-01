import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, lstat, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { AppError } from '../../core/errors';
import { abortError, assertLocalPath } from './safety';

export interface MediaMetadata {
  durationSeconds: number;
  hasAudio: boolean;
  mediaType: 'audio' | 'video';
}

export interface FFmpegMediaProcessorOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}

export type MediaSpawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const allowedFormats = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,ogg,mp3,wav,flac,aac,mpeg,mpegvideo,asf,amr';
const maximumProbeBytes = 64 * 1024;

/** 仅处理本地普通文件，命令始终通过参数数组执行，不经过 shell。 */
export class FFmpegMediaProcessor {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly timeoutMs: number;

  constructor(
    options: FFmpegMediaProcessorOptions = {},
    private readonly spawnImpl: MediaSpawn = spawn,
  ) {
    this.ffmpegPath = validateExecutable(options.ffmpegPath ?? 'ffmpeg');
    this.ffprobePath = validateExecutable(options.ffprobePath ?? 'ffprobe');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000) {
      throw new AppError('VALIDATION_ERROR', '媒体处理超时配置无效', 500);
    }
  }

  async probe(path: string, signal?: AbortSignal): Promise<MediaMetadata> {
    const source = await validateInput(path, signal);
    const output = await this.run(this.ffprobePath, [
      '-v', 'error',
      '-protocol_whitelist', 'file,pipe',
      '-format_whitelist', allowedFormats,
      '-show_entries', 'format=duration:stream=codec_type,duration',
      '-of', 'json',
      source,
    ], signal);
    let data: unknown;
    try {
      data = JSON.parse(output.toString('utf8')) as unknown;
    } catch {
      throw invalidMedia();
    }
    if (typeof data !== 'object' || data === null || !('streams' in data) || !Array.isArray(data.streams)) throw invalidMedia();
    const streams = data.streams as unknown[];
    if (streams.length > 128) throw invalidMedia();
    const streamTypes = streams.map((stream) => typeof stream === 'object' && stream !== null && 'codec_type' in stream ? stream.codec_type : null);
    const hasAudio = streamTypes.includes('audio');
    const hasVideo = streamTypes.includes('video');
    if (!hasAudio && !hasVideo) throw invalidMedia();
    const format = 'format' in data ? data.format : undefined;
    const duration = typeof format === 'object' && format !== null && 'duration' in format ? durationNumber(format.duration) : null;
    const fallbackDuration = Math.max(0, ...streams.map((stream) => typeof stream === 'object' && stream !== null && 'duration' in stream ? durationNumber(stream.duration) ?? 0 : 0));
    const durationSeconds = duration ?? fallbackDuration;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86_400) throw invalidMedia();
    return { durationSeconds, hasAudio, mediaType: hasVideo ? 'video' : 'audio' };
  }

  async extractMp3(
    path: string,
    out: string,
    startSeconds: number,
    durationSeconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 86_400 || !Number.isFinite(durationSeconds) || durationSeconds < 0.001 || durationSeconds > 600) {
      throw new AppError('VALIDATION_ERROR', '音轨片段范围无效', 400);
    }
    const source = await validateInput(path, signal);
    const output = assertLocalPath(out);
    if (source === output) throw new AppError('VALIDATION_ERROR', '音轨输出文件无效', 400);
    // -n 保护已有文件。禁止将源文件或已有文件作为清理目标。
    try {
      await lstat(output);
      throw new AppError('VALIDATION_ERROR', '音轨输出文件已存在', 400);
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const temporary = join(dirname(output), `.audio-${randomUUID()}.mp3`);
    try {
      await this.run(this.ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
        '-protocol_whitelist', 'file,pipe', '-format_whitelist', allowedFormats,
        '-ss', startSeconds.toFixed(3), '-i', source,
        '-t', durationSeconds.toFixed(3), '-map', '0:a:0', '-vn',
        '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k',
        '-f', 'mp3', temporary,
      ], signal);
      const info = await lstat(temporary);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw invalidMedia();
      if (signal?.aborted) throw abortError();
      // 同目录硬链接不会覆盖已存在的目标；失败清理也只涉及本次临时文件。
      await link(temporary, output);
    } catch (error) {
      throw error instanceof AppError || (error instanceof Error && error.name === 'AbortError') ? error : processingUnavailable();
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private run(executable: string, args: string[], signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnImpl(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        reject(processingUnavailable());
        return;
      }
      const chunks: Buffer[] = [];
      let byteSize = 0;
      let failure: Error | undefined;
      let settled = false;
      const stop = (error: Error) => {
        failure ??= error;
        try {
          child.kill('SIGKILL');
        } catch {
          finish(failure);
        }
      };
      const onAbort = () => stop(abortError());
      const timeout = setTimeout(() => stop(processingUnavailable()), this.timeoutMs);
      timeout.unref();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(Buffer.concat(chunks));
      };
      child.stdout?.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteSize += buffer.length;
        if (byteSize > maximumProbeBytes) {
          stop(invalidMedia());
          return;
        }
        chunks.push(buffer);
      });
      child.stdout?.on('error', () => stop(processingUnavailable()));
      child.on('error', () => { failure ??= processingUnavailable(); });
      child.on('close', (code) => finish(failure ?? (code === 0 ? undefined : invalidMedia())));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}

function validateExecutable(path: string): string {
  if (path.includes('\0') || (!isAbsolute(path) && path !== 'ffmpeg' && path !== 'ffprobe')) {
    throw new AppError('VALIDATION_ERROR', '媒体处理程序配置无效', 500);
  }
  return path;
}

async function validateInput(path: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw abortError();
  const source = assertLocalPath(path);
  try {
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw invalidMedia();
    return source;
  } catch (error) {
    throw error instanceof AppError ? error : invalidMedia();
  }
}

function durationNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function invalidMedia(): AppError {
  return new AppError('IMPORT_CONTENT_INVALID', '音视频文件无法读取或格式不支持', 400);
}

function processingUnavailable(): AppError {
  return new AppError('IMPORT_PARSE_FAILED', '媒体处理服务暂时不可用', 503, true);
}

import { open, readFile, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { AppError } from '../../core/errors';

const AudioParamsSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/u),
}).strict();
const AudioFileMapSchema = z.record(
  z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/u),
  z.string().regex(/^(?:2025|2026)\/(?:2025|2026)-\d{2}-\d{2}\/\d{3} - [^/\\]{1,240} - [a-f0-9]{10}\.mp3$/iu),
);

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function isInside(root: string, file: string): boolean {
  return file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export const editorialAudioRoutes: FastifyPluginAsync<{
  audioRoot: string | undefined;
  manifestPath: string;
}> = async (app, options) => {
  let audioFiles: Record<string, string> = {};
  try {
    const contents = await readFile(options.manifestPath, 'utf8');
    const parsed = AudioFileMapSchema.safeParse(JSON.parse(contents));
    if (parsed.success) audioFiles = parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('无法加载外刊音频清单');
    }
  }

  app.get('/v1/editorial/audio/:id', async (request, reply) => {
    const parsed = AudioParamsSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', '音频编号格式无效', 400);
    const relativePath = audioFiles[parsed.data.id];
    if (!relativePath || !options.audioRoot?.trim()) {
      throw new AppError('NOT_FOUND', '原刊音频不存在', 404);
    }

    const [year, date, filename] = relativePath.split('/');
    if (!year || !date || !filename || date.slice(0, 4) !== year) {
      throw new AppError('NOT_FOUND', '原刊音频不存在', 404);
    }

    let canonicalRoot: string;
    let canonicalFile: string;
    try {
      canonicalRoot = await realpath(resolve(options.audioRoot));
      canonicalFile = await realpath(resolve(canonicalRoot, year, date, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', '原刊音频不存在', 404);
      }
      throw new AppError('INTERNAL_ERROR', '音频服务暂时不可用', 500, true);
    }
    if (!isInside(canonicalRoot, canonicalFile)) {
      throw new AppError('NOT_FOUND', '原刊音频不存在', 404);
    }

    let file: FileHandle;
    try {
      file = await open(canonicalFile, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', '原刊音频不存在', 404);
      }
      throw new AppError('INTERNAL_ERROR', '音频服务暂时不可用', 500, true);
    }
    const info = await file.stat();
    if (!info.isFile()) {
      await file.close();
      throw new AppError('NOT_FOUND', '原刊音频不存在', 404);
    }
    reply.type('audio/mpeg')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=3600')
      .header('accept-ranges', 'bytes');

    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, info.size);
      if (!range) {
        await file.close();
        return reply.code(416).header('content-range', `bytes */${info.size}`).send();
      }
      return reply.code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
        .header('content-length', range.end - range.start + 1)
        .send(file.createReadStream({ start: range.start, end: range.end }));
    }
    return reply.header('content-length', info.size).send(file.createReadStream());
  });
};

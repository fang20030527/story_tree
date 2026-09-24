import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import {
  PublishedEditorialArticleSchema,
  PublishedEditorialCatalogSchema,
  PublishedEditorialIdSchema,
} from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../core/errors';
import {
  createPublishedEditorialStore,
  PublishedEditorialAssetNameSchema,
} from './published-content';

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
};

function parseParam(request: { params: unknown }, key: 'id' | 'name'): string {
  const value = (request.params as Record<string, unknown>)[key];
  const schema = key === 'id' ? PublishedEditorialIdSchema : PublishedEditorialAssetNameSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '外刊编号格式无效', 400);
  return parsed.data;
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export const publishedEditorialRoutes: FastifyPluginAsync<{ contentDirectory: string }> = async (app, options) => {
  const store = createPublishedEditorialStore(options.contentDirectory);

  app.get('/v1/editorial/articles', async (_request, reply) => {
    const catalog = await store.list();
    return reply.header('cache-control', 'no-store')
      .send(PublishedEditorialCatalogSchema.parse(catalog));
  });

  app.get('/v1/editorial/articles/:id', async (request, reply) => {
    const article = await store.get(parseParam(request, 'id'));
    if (!article) throw new AppError('NOT_FOUND', '外刊不存在', 404);
    return reply.header('cache-control', 'no-store')
      .send(PublishedEditorialArticleSchema.parse(article));
  });

  app.get('/v1/editorial/assets/:name', async (request, reply) => {
    const name = parseParam(request, 'name');
    if (!(await store.hasAsset(name))) throw new AppError('NOT_FOUND', '外刊素材不存在', 404);
    const path = join(options.contentDirectory, 'assets', name);
    const info = await stat(path);
    const type = MEDIA_TYPES[extname(name)];
    if (!type) throw new AppError('NOT_FOUND', '外刊素材不存在', 404);
    reply.type(type)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=60')
      .header('accept-ranges', 'bytes');
    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, info.size);
      if (!range) {
        return reply.code(416).header('content-range', `bytes */${info.size}`).send();
      }
      return reply.code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
        .header('content-length', range.end - range.start + 1)
        .send(createReadStream(path, { start: range.start, end: range.end }));
    }
    return reply.header('content-length', info.size).send(createReadStream(path));
  });
};

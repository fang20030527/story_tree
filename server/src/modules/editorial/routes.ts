import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { EditorialImageParamsSchema } from '@context-reader/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../core/errors';

// 公共原刊插图仅允许内容摘要文件名，不接受路径或任意远程 URL。
export const editorialImageRoutes: FastifyPluginAsync<{ assetDirectory: string }> = async (app, options) => {
  app.get('/v1/editorial/images/:id', async (request, reply) => {
    const parsed = EditorialImageParamsSchema.safeParse(request.params);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', '图片编号格式无效', 400);
    let file;
    try {
      file = await open(join(options.assetDirectory, parsed.data.id), 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', '原刊图片不存在', 404);
      }
      throw error;
    }
    const etag = `"${parsed.data.id}"`;
    reply.header('etag', etag).header('cache-control', 'public, max-age=31536000, immutable');
    if (request.headers['if-none-match'] === etag) {
      await file.close();
      return reply.code(304).send();
    }
    return reply.type('image/webp').header('x-content-type-options', 'nosniff').send(file.createReadStream());
  });
};

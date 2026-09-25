import {
  EditorialImageParamsSchema,
  PublishedEditorialCatalogSchema,
  PublishedEditorialIdSchema,
} from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

const IMAGE_PATH = /^\/v1\/editorial\/images\/([^/]+)$/u;
const ARTICLE_PATH = /^\/v1\/editorial\/articles\/([^/]+)$/u;
const ASSET_PATH = /^\/v1\/editorial\/assets\/([^/]+)$/u;
const ASSET_NAME = /^[a-z0-9][a-z0-9._-]{0,127}\.(?:webp|png|jpe?g|mp3)$/u;

// The current published-content directory has no articles. Preserve the
// public catalog contract until a separate editorial publishing flow exists.
const EMPTY_CATALOG = PublishedEditorialCatalogSchema.parse({ articles: [] });

export async function handlePublicEditorialRoute(
  request: Request,
  env: ApiEnv,
): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = new URL(request.url).pathname;
  if (path === '/v1/editorial/articles') {
    return Response.json(EMPTY_CATALOG, { headers: { 'cache-control': 'no-store' } });
  }
  const article = ARTICLE_PATH.exec(path);
  if (article) {
    if (!PublishedEditorialIdSchema.safeParse(article[1]).success) {
      throw new AppError('VALIDATION_ERROR', '外刊编号格式无效', 400);
    }
    throw new AppError('NOT_FOUND', '外刊不存在', 404);
  }
  const asset = ASSET_PATH.exec(path);
  if (asset) {
    if (!asset[1] || asset[1].length < 6 || asset[1].length > 132 ||
        !ASSET_NAME.test(asset[1])) {
      throw new AppError('VALIDATION_ERROR', '外刊编号格式无效', 400);
    }
    throw new AppError('NOT_FOUND', '外刊素材不存在', 404);
  }
  const image = IMAGE_PATH.exec(path);
  if (!image) return null;
  const parsed = EditorialImageParamsSchema.safeParse({ id: image[1] });
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '图片编号格式无效', 400);
  if (!env.IMAGE_SERVICE) throw new AppError('NOT_FOUND', '原刊图片不存在', 404);
  const upstream = new URL(`/${parsed.data.id}`, request.url);
  const etag = request.headers.get('if-none-match');
  const response = await env.IMAGE_SERVICE.fetch(new Request(upstream, {
    method: request.method,
    headers: etag ? { 'if-none-match': etag } : {},
  }));
  if (response.status === 404) throw new AppError('NOT_FOUND', '原刊图片不存在', 404);
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}

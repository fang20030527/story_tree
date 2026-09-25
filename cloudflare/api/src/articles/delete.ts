import { UuidSchema } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';

const ARTICLE_PATH = /^\/v1\/articles\/([^/]+)$/u;
const R2_DELETE_BATCH_SIZE = 1_000;

interface AssetKeyRow {
  objectKey: string;
}

/** Delete an owned article and its non-FK jobs in one D1 transaction. */
export async function deleteArticleForUser(
  env: ApiEnv,
  input: { userId: string; articleId: string },
): Promise<void> {
  const { articleId, userId } = input;
  const results = await env.DB.batch([
    env.DB.prepare(`
      SELECT asset.object_key AS objectKey
      FROM import_assets AS asset
      JOIN article_imports AS article_import ON article_import.id = asset.article_import_id
      JOIN imported_articles AS article ON article.id = article_import.article_id
      WHERE article.id = ?1 AND article.user_id = ?2
    `).bind(articleId, userId),
    env.DB.prepare(`
      DELETE FROM jobs
      WHERE (kind = 'article_import' AND resource_id IN (
        SELECT article_import.id
        FROM article_imports AS article_import
        JOIN imported_articles AS article ON article.id = article_import.article_id
        WHERE article.id = ?1 AND article.user_id = ?2
      )) OR (kind = 'article_translation' AND resource_id IN (
        SELECT translation.id
        FROM article_translations AS translation
        JOIN imported_articles AS article ON article.id = translation.article_id
        WHERE article.id = ?1 AND article.user_id = ?2
      ))
    `).bind(articleId, userId),
    env.DB.prepare(`
      DELETE FROM imported_articles
      WHERE id = ?1 AND user_id = ?2
    `).bind(articleId, userId),
  ]);

  // The D1 cascade removes import_assets, but R2 cannot participate in that
  // transaction. Reconcile failed object deletions with the orphan sweep.
  const assetKeys = (results[0] as { results?: AssetKeyRow[] } | undefined)?.results
    ?.map(({ objectKey }) => objectKey) ?? [];
  try {
    for (let start = 0; start < assetKeys.length; start += R2_DELETE_BATCH_SIZE) {
      await env.IMPORT_BUCKET.delete(assetKeys.slice(start, start + R2_DELETE_BATCH_SIZE));
    }
  } catch {
    // The article is already deleted; keep the HTTP result idempotent.
  }
}

/** Returns null for requests outside DELETE /v1/articles/:id. */
export async function handleArticleDeleteRoute(
  request: Request,
  env: ApiEnv,
  userId: string,
): Promise<Response | null> {
  if (request.method !== 'DELETE') return null;
  const match = ARTICLE_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;

  let articleId: string;
  try {
    articleId = decodeURIComponent(match[1]!);
  } catch {
    throw new AppError('VALIDATION_ERROR', '文章编号格式无效', 400);
  }
  if (!UuidSchema.safeParse(articleId).success) {
    throw new AppError('VALIDATION_ERROR', '文章编号格式无效', 400);
  }

  await deleteArticleForUser(env, { userId, articleId });
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

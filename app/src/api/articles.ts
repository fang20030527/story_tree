import {
  ImportedArticleDtoSchema,
  ImportedArticlePageSchema,
  type ImportedArticleDto,
  type ImportedArticlePage,
} from '@context-reader/contracts';

import { apiRequest, apiRequestNoContent } from './client';

export function listImportedArticles(
  input: { cursor?: string; limit?: number } = {},
): Promise<ImportedArticlePage> {
  const query = new URLSearchParams();
  query.set('limit', String(input.limit ?? 30));
  if (input.cursor) query.set('cursor', input.cursor);
  return apiRequest(
    `/v1/articles?${query.toString()}`,
    ImportedArticlePageSchema,
  );
}

export function getImportedArticle(
  articleId: string,
): Promise<ImportedArticleDto> {
  return apiRequest(
    `/v1/articles/${encodeURIComponent(articleId)}`,
    ImportedArticleDtoSchema,
  );
}

export function deleteImportedArticle(articleId: string): Promise<void> {
  return apiRequestNoContent(
    `/v1/articles/${encodeURIComponent(articleId)}`,
    { method: 'DELETE' },
  );
}

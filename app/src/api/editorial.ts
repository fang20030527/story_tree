import {
  PublishedEditorialArticleSchema,
  PublishedEditorialCatalogSchema,
} from '@context-reader/contracts';

import { getApiBaseUrl, publicApiRequest } from './client';

export function listPublishedEditorialArticles() {
  return publicApiRequest('/v1/editorial/articles', PublishedEditorialCatalogSchema);
}

export function getPublishedEditorialArticle(id: string) {
  return publicApiRequest(
    `/v1/editorial/articles/${encodeURIComponent(id)}`,
    PublishedEditorialArticleSchema,
  );
}

export function resolvePublishedEditorialMedia(value: string): string {
  return value.startsWith('/v1/editorial/assets/')
    ? `${getApiBaseUrl()}${value}`
    : value;
}

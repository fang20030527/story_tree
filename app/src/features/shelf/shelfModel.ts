import type { ImportedArticleSummaryDto } from '@context-reader/contracts';

import {
  getEditorialArticle,
  type EditorialArticle,
} from '@/features/editorial/catalog';

import type { EditorialShelfEntry } from './editorialShelfStorage';

export type ShelfFilter = 'all' | 'editorial' | 'imported';

export type ShelfItem =
  | {
      kind: 'editorial';
      id: string;
      timestamp: string;
      article: EditorialArticle;
    }
  | {
      kind: 'imported';
      id: string;
      timestamp: string;
      article: ImportedArticleSummaryDto;
    };

export function mergeImportedArticles(
  existing: readonly ImportedArticleSummaryDto[],
  incoming: readonly ImportedArticleSummaryDto[],
): ImportedArticleSummaryDto[] {
  const byId = new Map(existing.map((article) => [article.id, article]));
  for (const article of incoming) byId.set(article.id, article);
  return [...byId.values()].sort(
    (left, right) =>
      right.importedAt.localeCompare(left.importedAt) ||
      right.id.localeCompare(left.id),
  );
}

export function mergeShelfItems(
  editorialEntries: readonly EditorialShelfEntry[],
  importedArticles: readonly ImportedArticleSummaryDto[],
): ShelfItem[] {
  const editorialItems = editorialEntries.flatMap((entry): ShelfItem[] => {
    const article = getEditorialArticle(entry.articleId);
    return article
      ? [
          {
            kind: 'editorial',
            id: article.id,
            timestamp: entry.addedAt,
            article,
          },
        ]
      : [];
  });
  const importedItems: ShelfItem[] = importedArticles.map((article) => ({
    kind: 'imported',
    id: article.id,
    timestamp: article.importedAt,
    article,
  }));
  return [...editorialItems, ...importedItems].sort(
    (left, right) =>
      right.timestamp.localeCompare(left.timestamp) ||
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
  );
}

export function filterShelfItems(
  items: readonly ShelfItem[],
  filter: ShelfFilter,
): ShelfItem[] {
  return filter === 'all'
    ? [...items]
    : items.filter(({ kind }) => kind === filter);
}

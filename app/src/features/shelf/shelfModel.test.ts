import type { ImportedArticleSummaryDto } from '@context-reader/contracts';

import {
  filterShelfItems,
  mergeImportedArticles,
  mergeShelfItems,
} from './shelfModel';

const imported = (
  id: string,
  title: string,
  importedAt: string,
): ImportedArticleSummaryDto => ({
  id,
  title,
  importedAt,
  sourceKind: 'paste',
  sourceUrl: null,
  wordCount: 800,
});

describe('shelf model', () => {
  it('merges pages by ID and keeps the newest server representation', () => {
    const old = imported(
      '11111111-1111-4111-8111-111111111111',
      'Old title',
      '2026-09-10T08:00:00.000Z',
    );
    const updated = { ...old, title: 'Updated title' };
    const newer = imported(
      '22222222-2222-4222-8222-222222222222',
      'Newer',
      '2026-09-12T08:00:00.000Z',
    );

    expect(mergeImportedArticles([old], [updated, newer])).toEqual([
      newer,
      updated,
    ]);
  });

  it('combines both sources newest-first and filters without mutation', () => {
    const privateArticle = imported(
      '11111111-1111-4111-8111-111111111111',
      'Private',
      '2026-09-11T08:00:00.000Z',
    );
    const items = mergeShelfItems(
      [
        { articleId: 'hero', addedAt: '2026-09-10T08:00:00.000Z' },
        { articleId: 'ai-arms-race', addedAt: '2026-09-12T08:00:00.000Z' },
      ],
      [privateArticle],
    );

    expect(items.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'editorial:ai-arms-race',
      `imported:${privateArticle.id}`,
      'editorial:hero',
    ]);
    expect(filterShelfItems(items, 'editorial').map(({ id }) => id)).toEqual([
      'ai-arms-race',
      'hero',
    ]);
    expect(filterShelfItems(items, 'imported').map(({ id }) => id)).toEqual([
      privateArticle.id,
    ]);
    expect(filterShelfItems(items, 'all')).not.toBe(items);
  });
});

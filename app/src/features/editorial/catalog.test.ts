import {
  editorialArticles,
  getEditorialArticle,
  getEditorialSection,
  searchEditorialArticles,
} from './catalog';

describe('editorial catalog', () => {
  it('uses unique stable IDs and complete overview/reader content', () => {
    expect(new Set(editorialArticles.map(({ id }) => id)).size).toBe(
      editorialArticles.length,
    );
    expect(editorialArticles.map(({ id }) => id)).toEqual([
      'hero',
      'a1',
      'a2',
      'a3',
      'a4',
      'n1',
      'n2',
      'k1',
      'k2',
    ]);
    for (const article of editorialArticles) {
      expect(article.titleZh).not.toHaveLength(0);
      expect(article.titleEn).not.toHaveLength(0);
      expect(article.summaryZh).not.toHaveLength(0);
      expect(article.keyPointsZh.length).toBeGreaterThanOrEqual(2);
      expect(article.paragraphs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('retrieves sections and searches title, source, and category', () => {
    expect(getEditorialArticle('hero')?.source).toBe('The Guardian');
    expect(getEditorialArticle('missing')).toBeUndefined();
    expect(getEditorialSection('today').map(({ id }) => id)).toEqual(['hero']);
    expect(getEditorialSection('featured').map(({ id }) => id)).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ]);
    expect(getEditorialSection('daily').map(({ id }) => id)).toEqual(['n1', 'n2']);
    expect(getEditorialSection('kids').map(({ id }) => id)).toEqual(['k1', 'k2']);
    expect(searchEditorialArticles('科技').map(({ id }) => id)).toContain('a1');
    expect(searchEditorialArticles('the atlantic').map(({ id }) => id)).toContain(
      'a2',
    );
    expect(searchEditorialArticles('动物').map(({ id }) => id)).toContain('a4');
    expect(searchEditorialArticles('   ')).toEqual(editorialArticles);
  });
});

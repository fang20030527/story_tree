import {
  editorialArticles,
  getEditorialArticle,
  getEditorialSection,
  searchEditorialArticles,
} from './catalog';

describe('editorial catalog', () => {
  it('includes every entry of the September 19 issue, including image-only indicators', () => {
    const issue = getEditorialSection('featured').filter((article) => article.issueDate === '2026-09-19');
    expect(issue).toHaveLength(76);
    expect(issue.reduce((sum, article) => sum + article.wordCount, 0)).toBe(63692);
    expect(issue[0]?.titleEn).toBe('Politics');
    expect(issue[75]?.titleEn).toBe('Gloria Steinem changed the world for American women');
    const indicators = issue.find((article) => article.titleEn === 'Economic data, commodities and markets');
    expect(indicators?.bodyBlocks?.filter((block) => block.type === 'image')).toHaveLength(4);
    expect(searchEditorialArticles('Gloria Steinem')).toContain(issue[75]);
    for (const article of issue) {
      expect(getEditorialArticle(article.id)).toBe(article);
      expect(article.bodyBlocks?.filter((block) => block.type === 'text').map((block) => block.text)).toEqual(article.paragraphs);
      expect(article.paragraphs.join(' ')).not.toContain('This article was downloaded by');
    }
  });

  it('uses unique stable IDs and complete overview/reader content', () => {
    expect(new Set(editorialArticles.map(({ id }) => id)).size).toBe(
      editorialArticles.length,
    );
    expect(editorialArticles.filter((article) => !article.issueDate).map(({ id }) => id)).toEqual([
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
      expect(article.bodyBlocks?.length ?? article.paragraphs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('retrieves sections and searches title, source, and category', () => {
    expect(getEditorialArticle('hero')?.source).toBe('The Guardian');
    expect(getEditorialArticle('missing')).toBeUndefined();
    expect(getEditorialSection('today').map(({ id }) => id)).toEqual(['hero']);
    expect(getEditorialSection('featured').slice(0, 4).map(({ id }) => id)).toEqual([
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

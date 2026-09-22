import {
  editorialArticles,
  getEditorialArticle,
  getEditorialSection,
  searchEditorialArticles,
} from './catalog';
import { epubArticles } from './epubCatalog';

const importedIds = new Set(epubArticles.map((article) => article.id));

describe('editorial catalog', () => {
  it('uses unique stable IDs and complete overview/reader content', () => {
    expect(new Set(editorialArticles.map(({ id }) => id)).size).toBe(
      editorialArticles.length,
    );
    expect(editorialArticles.filter((article) => !article.issueDate).map(({ id }) => id)).toEqual([
      'hero',
      'ai-arms-race',
      'deepmind-robot-brains',
      'new-cat-species',
      'food-waste-recycling',
      'secret-agent-sketchbook',
      'viking-word-independence',

    ]);
    // 批量原刊正文的完整性由导入校验和 epubCatalog.test 覆盖；这里保留原栏目回归。
    for (const article of editorialArticles.filter((entry) => !importedIds.has(entry.id))) {
      expect(article.titleZh).not.toHaveLength(0);
      expect(article.titleEn).not.toHaveLength(0);
      expect(article.summaryZh).not.toHaveLength(0);
      expect(article.keyPointsZh.length).toBeGreaterThanOrEqual(2);
      expect(article.bodyBlocks?.length ?? article.paragraphs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('retrieves sections and searches title, source, and category', () => {
    expect(getEditorialArticle('hero')?.source).toBe('BBC Future');
    expect(getEditorialArticle('missing')).toBeUndefined();
    expect(getEditorialSection('today').map(({ id }) => id)).toEqual(['hero']);
    expect(getEditorialSection('featured').filter((article) => !article.issueDate).map(({ id }) => id)).toEqual(["ai-arms-race", "deepmind-robot-brains", "new-cat-species", "food-waste-recycling", "secret-agent-sketchbook", "viking-word-independence"]);
    expect(searchEditorialArticles('自然').map(({ id }) => id)).toContain('hero');
    expect(searchEditorialArticles('bbc future').map(({ id }) => id)).toContain(
      'hero',
    );
    expect(getEditorialArticle('a1')).toBeUndefined();
    expect(searchEditorialArticles('   ')).toEqual(editorialArticles);
  });
});
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

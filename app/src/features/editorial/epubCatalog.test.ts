import { editorialCanListen, getEditorialArticle, searchEditorialArticles } from './catalog';
import { epubArticles, getEpubImageUrl } from './epubCatalog';
import { issueLoaders } from './epub/loaders';

// 使用 require 避免 TypeScript 为大型生成数据展开字面量类型。
const report = require('./epub/import-report.json') as {
  epubCount: number;
  articleCount: number;
  errors: unknown[];
  issues: { key: string; articleCount: number; tocCount: number; preserved: boolean; excludedEntries?: unknown[] }[];
};

it('accounts for every EPUB and preserves the existing issue without duplicate IDs', () => {
  expect(report.epubCount).toBe(215);
  expect(report.issues).toHaveLength(215);
  expect(report.errors).toEqual([]);
  expect(epubArticles.length + 76).toBe(report.articleCount);
  expect(new Set(epubArticles.map((article) => article.id)).size).toBe(epubArticles.length);
  for (const issue of report.issues) {
    expect(issue.articleCount + (issue.excludedEntries?.length ?? 0)).toBe(issue.tocCount);
    expect(issue.articleCount).toBeGreaterThan(0);
  }
  for (const article of epubArticles) {
    expect(article.id.length).toBeLessThanOrEqual(64);
    expect(getEditorialArticle(article.id)).toBe(article);
  }
  expect(getEditorialArticle('economist-2026-09-19-0c23ddbe-988f-4b85-adff-aa7431415ebf')?.titleZh)
    .toBe('格洛丽亚·斯泰纳姆改变了美国女性的世界');
});

it.each(['The Economist', 'The New Yorker', 'The Atlantic', 'WIRED'])('opens original text and illustrations from %s', (source) => {
  const article = epubArticles.find((entry) => entry.source === source)!;
  expect(article).toBeDefined();
  expect(searchEditorialArticles(source)).toContain(article);
  expect(searchEditorialArticles(article.issueDate!)).toContain(article);
  expect(article.paragraphs.length).toBeGreaterThan(0);
  expect(article.bodyBlocks?.filter((block) => block.type === 'text').map((block) => block.text)).toEqual(article.paragraphs);
  expect(article.bodyBlocks?.some((block) => block.type === 'image')).toBe(true);
  expect(article.paragraphs.join(' ')).not.toMatch(/This article was downloaded by|Section menu/);
  expect(article.bodyBlocks).toBe(article.bodyBlocks);
});

it('does not load an issue body when searching its metadata', () => {
  const key = Object.keys(issueLoaders).find((value) => value.startsWith('wired-2026-01'))!;
  const load = jest.spyOn(issueLoaders, key);
  searchEditorialArticles('WIRED');
  expect(load).not.toHaveBeenCalled();
  load.mockRestore();
});

it('attaches all repository recordings to the matching issue and article', () => {
  const audioReport = require('./epub/audio-report.json') as {
    entryCount: number; matchedCount: number; unmatched: unknown[];
    matched: Record<string, { article: string; issueDate: string; url: string }>;
  };
  expect(audioReport.entryCount).toBe(910);
  expect(audioReport.matchedCount).toBe(audioReport.entryCount);
  expect(audioReport.unmatched).toEqual([]);
  expect(epubArticles.filter(editorialCanListen)).toHaveLength(910);
  for (const [id, recording] of Object.entries(audioReport.matched)) {
    const article = getEditorialArticle(id)!;
    expect(article.source).toBe('The Economist');
    expect(article.issueDate).toBe(recording.issueDate);
    expect(article.titleEn).toBe(recording.article);
    expect(article.audioUrl).toBe(recording.url);
    expect(article.hasAudio).toBe(true);
    expect(editorialCanListen(article)).toBe(true);
  }
  expect(epubArticles.filter((article) => !article.audioUrl).every((article) => !article.hasAudio)).toBe(true);
  expect(getEditorialArticle('ai-arms-race')?.audioAsset).toBeDefined();
});

it('uses the configured API origin for illustrations without bundling their bytes', () => {
  const original = process.env.EXPO_PUBLIC_API_BASE_URL;
  try {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://reader.example.test';
    expect(getEpubImageUrl('0123456789abcdef01234567'))
      .toBe('https://reader.example.test/v1/editorial/images/0123456789abcdef01234567.webp');
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(getEpubImageUrl('0123456789abcdef01234567')).toBe('');
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = original;
  }
});

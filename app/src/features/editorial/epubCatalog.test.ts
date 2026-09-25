import { editorialCanListen, getEditorialArticle, searchEditorialArticles } from './catalog';
import { epubArticles, getEditorialAudioUrl, getEpubImageUrl } from './epubCatalog';
import { epubMetadata, issueLoaders } from './epub/loaders';

const localizedMetadata = require('./epub/metadata-zh.json') as Record<string, {
  titleEn: string; titleZh: string; category: string; level: string;
}>;

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

it('gives every bulk EPUB article a Chinese title, topic and difficulty', () => {
  expect(Object.keys(localizedMetadata)).toHaveLength(epubArticles.length);
  for (const [index, article] of epubArticles.entries()) {
    const localized = localizedMetadata[article.id];
    expect(localized?.titleEn).toBe(epubMetadata[index]?.titleEn);
    expect(article.titleZh).toMatch(/[\u3400-\u9fff]/);
    expect(article.category).toMatch(/^[\u3400-\u9fff]+$/);
    expect(article.level).toMatch(/^(雅思 [678]\.\d|难度待评估)$/);
  }
  const politics = epubArticles.find((article) => article.titleEn === 'Politics');
  expect(politics?.titleZh).toBe('政治');
  expect(searchEditorialArticles('政治')).toContain(politics);
  const titleWithMarkup = epubMetadata.find((entry) => entry.titleEn.includes('<em'))!;
  expect(getEditorialArticle(titleWithMarkup.id)?.titleEn).not.toMatch(/<[^>]+>|&amp;/);
});

it('attaches only 2026 recordings to the matching issue and article', () => {
  const audioReport = require('./epub/audio-local-report.json') as {
    scannedFileCount: number; matchedArticleCount: number; unmatchedFileCount: number;
    matched: { articleId: string; issueDate: string }[];
  };
  expect(audioReport.scannedFileCount).toBe(2725);
  expect(audioReport.matchedArticleCount).toBe(2674);
  expect(audioReport.unmatchedFileCount).toBe(51);
  for (const recording of audioReport.matched) {
    const article = getEditorialArticle(recording.articleId)!;
    expect(article.source).toBe('The Economist');
    expect(article.issueDate).toBe(recording.issueDate);
    expect(recording.issueDate).toMatch(/^2026-/);
    expect(article.audioUrl).toBe(getEditorialAudioUrl(recording.articleId));
    if (article.audioUrl) {
      expect(article.hasAudio).toBe(true);
      expect(editorialCanListen(article)).toBe(true);
    }
  }
  expect(epubArticles.filter((article) => !article.audioUrl).every((article) => !article.hasAudio)).toBe(true);
  expect(getEditorialArticle('ai-arms-race')?.audioAsset).toBeDefined();
  expect(editorialCanListen(getEditorialArticle('hero')!)).toBe(false);
  expect(editorialCanListen(getEditorialArticle('deepmind-robot-brains')!)).toBe(false);
});

it('uses the configured API origin for illustrations without bundling their bytes', () => {
  const original = process.env.EXPO_PUBLIC_API_BASE_URL;
  const originalImageOrigin = process.env.EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN;
  try {
    delete process.env.EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN;
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://reader.example.test';
    expect(getEpubImageUrl('0123456789abcdef01234567'))
      .toBe('https://reader.example.test/v1/editorial/images/0123456789abcdef01234567.webp');
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(getEpubImageUrl('0123456789abcdef01234567')).toBe('');
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL = original;
    if (originalImageOrigin === undefined) delete process.env.EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN;
    else process.env.EXPO_PUBLIC_EDITORIAL_IMAGE_ORIGIN = originalImageOrigin;
  }
});

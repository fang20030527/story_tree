import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublishedEditorialArticle, PublishedEditorialSummary } from '@context-reader/contracts';

import {
  getPublishedEditorialArticle,
  listPublishedEditorialArticles,
} from '@/api/editorial';
import { EDITORIAL_CATALOG_CACHE_KEY } from '@/api/storage';

import { getEditorialArticle, getEditorialSection, searchEditorialArticles } from './catalog';
import {
  refreshRemoteEditorialCatalog,
  refreshRemoteEditorialDetail,
} from './remoteCatalog';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/api/editorial', () => ({
  listPublishedEditorialArticles: jest.fn(),
  getPublishedEditorialArticle: jest.fn(),
  resolvePublishedEditorialMedia: (value: string) => value.startsWith('/v1/')
    ? `https://api.example${value}` : value,
}));

const summary: PublishedEditorialSummary = {
  id: 'remote-2026-09-24-01',
  titleZh: '服务端每日新文章',
  titleEn: 'A new daily article',
  summaryZh: '这篇文章来自服务端。',
  keyPointsZh: ['无需更新应用'],
  source: 'New Magazine',
  category: '科技',
  wordCount: 9,
  minutes: 1,
  level: '雅思 6.5',
  image: '/v1/editorial/assets/daily-cover.webp',
  section: 'today',
  publishedAt: '2026-09-24',
  hasAudio: true,
};

it('adds deployed articles to discovery and reading, keeps the last catalog on failure, and removes unpublished entries', async () => {
  const list = jest.mocked(listPublishedEditorialArticles);
  const detail = jest.mocked(getPublishedEditorialArticle);
  list.mockResolvedValueOnce({ articles: [summary] });
  detail.mockResolvedValueOnce({
    ...summary,
    paragraphs: ['A new article is available without an app update.'],
  } satisfies PublishedEditorialArticle);

  await refreshRemoteEditorialCatalog();
  expect(getEditorialSection('today').map((article) => article.id)).toEqual([summary.id]);
  expect(getEditorialSection('featured').some((article) => article.id === 'hero')).toBe(true);
  expect(searchEditorialArticles('New Magazine').map((article) => article.id)).toEqual([summary.id]);
  expect(getEditorialArticle(summary.id)?.image).toBe('https://api.example/v1/editorial/assets/daily-cover.webp');
  expect(JSON.parse((await AsyncStorage.getItem(EDITORIAL_CATALOG_CACHE_KEY)) ?? '').articles).toHaveLength(1);

  await refreshRemoteEditorialDetail(summary.id);
  expect(getEditorialArticle(summary.id)?.paragraphs).toEqual([
    'A new article is available without an app update.',
  ]);

  list.mockRejectedValueOnce(new Error('offline'));
  await expect(refreshRemoteEditorialCatalog()).rejects.toThrow('offline');
  expect(getEditorialSection('today')[0]?.id).toBe(summary.id);

  list.mockResolvedValueOnce({ articles: [] });
  await refreshRemoteEditorialCatalog();
  expect(getEditorialSection('today')[0]?.id).toBe('hero');
  expect(getEditorialArticle(summary.id)).toBeUndefined();
});

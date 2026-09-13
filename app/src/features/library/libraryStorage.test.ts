import AsyncStorage from '@react-native-async-storage/async-storage';

import { FAVORITES_KEY, RECENT_VIEWS_KEY } from '@/api/storage';

import {
  clearFavorites,
  clearRecentViews,
  isFavorite,
  loadFavorites,
  loadRecentViews,
  recordEditorialRecentView,
  recordImportedRecentView,
  removeFavorite,
  removeRecentView,
  toggleFavorite,
} from './libraryStorage';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

const articleA = {
  articleId: '11111111-1111-4111-8111-111111111111',
  title: 'Article A',
  sourceKind: 'url' as const,
  wordCount: 1200,
};
const articleB = {
  articleId: '22222222-2222-4222-8222-222222222222',
  title: 'Article B',
  sourceKind: 'paste' as const,
  wordCount: 800,
};
const importedA = {
  articleId: '11111111-1111-4111-8111-111111111111',
  title: 'Article A',
  sourceKind: 'url' as const,
  wordCount: 1200,
};

describe('library storage', () => {
  beforeEach(async () => {
    jest.useRealTimers();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('migrates legacy entries once and persists the imported discriminator', async () => {
    await AsyncStorage.setItem(
      RECENT_VIEWS_KEY,
      JSON.stringify([
        {
          ...importedA,
          timestamp: '2026-09-10T08:00:00.000Z',
        },
      ]),
    );

    expect(await loadRecentViews()).toEqual([
      {
        kind: 'imported',
        ...importedA,
        timestamp: '2026-09-10T08:00:00.000Z',
      },
    ]);
    expect(
      JSON.parse((await AsyncStorage.getItem(RECENT_VIEWS_KEY))!),
    ).toEqual([
      {
        kind: 'imported',
        ...importedA,
        timestamp: '2026-09-10T08:00:00.000Z',
      },
    ]);
  });

  it('records both kinds newest-first and de-duplicates by stable key', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-12T08:00:00.000Z'));
    await recordImportedRecentView(importedA);
    jest.setSystemTime(new Date('2026-09-12T09:00:00.000Z'));
    await recordEditorialRecentView('hero');
    jest.setSystemTime(new Date('2026-09-12T10:00:00.000Z'));
    await recordImportedRecentView(importedA);

    const views = await loadRecentViews();
    expect(views.map(({ kind, articleId }) => `${kind}:${articleId}`)).toEqual([
      `imported:${importedA.articleId}`,
      'editorial:hero',
    ]);
  });

  it('removes by discriminated key and keeps same textual IDs isolated', async () => {
    await AsyncStorage.setItem(
      RECENT_VIEWS_KEY,
      JSON.stringify([
        {
          kind: 'editorial',
          articleId: 'hero',
          timestamp: '2026-09-12T09:00:00.000Z',
        },
        {
          kind: 'imported',
          ...importedA,
          timestamp: '2026-09-12T08:00:00.000Z',
        },
      ]),
    );
    await removeRecentView('editorial:hero');
    expect((await loadRecentViews()).map(({ kind }) => kind)).toEqual([
      'imported',
    ]);
  });

  it('filters invalid and retired entries and safely resets broken payloads', async () => {
    await AsyncStorage.setItem(
      RECENT_VIEWS_KEY,
      JSON.stringify([
        {
          kind: 'editorial',
          articleId: 'missing',
          timestamp: new Date().toISOString(),
        },
        { kind: 'imported', nope: true },
      ]),
    );
    expect(await loadRecentViews()).toEqual([]);
    await AsyncStorage.setItem(RECENT_VIEWS_KEY, '{broken');
    expect(await loadRecentViews()).toEqual([]);
  });

  it('toggles favorites on and off', async () => {
    expect(await toggleFavorite(articleA)).toBe(true);
    expect(await isFavorite(articleA.articleId)).toBe(true);

    expect(await toggleFavorite(articleA)).toBe(false);
    expect(await isFavorite(articleA.articleId)).toBe(false);
    expect(await loadFavorites()).toEqual([]);
  });

  it('removes a favorite and clears all favorites', async () => {
    await toggleFavorite(articleA);
    await toggleFavorite(articleB);

    await removeFavorite(articleA.articleId);
    expect((await loadFavorites()).map((item) => item.articleId)).toEqual([
      articleB.articleId,
    ]);

    await clearFavorites();
    expect(await loadFavorites()).toEqual([]);
    expect(await AsyncStorage.getItem(FAVORITES_KEY)).toBeNull();
  });

  it('ignores corrupted stored payloads', async () => {
    await AsyncStorage.setItem(RECENT_VIEWS_KEY, 'not json');
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify([{ nope: 1 }]));

    expect(await loadRecentViews()).toEqual([]);
    expect(await loadFavorites()).toEqual([]);
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';

import { FAVORITES_KEY, RECENT_VIEWS_KEY } from '@/api/storage';

import {
  clearFavorites,
  clearRecentViews,
  isFavorite,
  loadFavorites,
  loadRecentViews,
  recordRecentView,
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

describe('library storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('records recent views newest-first and de-duplicates by article', async () => {
    await recordRecentView(articleA);
    await recordRecentView(articleB);
    await recordRecentView(articleA);

    const views = await loadRecentViews();
    expect(views.map((item) => item.articleId)).toEqual([
      articleA.articleId,
      articleB.articleId,
    ]);
  });

  it('removes a single recent view and clears all', async () => {
    await recordRecentView(articleA);
    await recordRecentView(articleB);

    await removeRecentView(articleA.articleId);
    expect((await loadRecentViews()).map((item) => item.articleId)).toEqual([
      articleB.articleId,
    ]);

    await clearRecentViews();
    expect(await loadRecentViews()).toEqual([]);
    expect(await AsyncStorage.getItem(RECENT_VIEWS_KEY)).toBeNull();
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

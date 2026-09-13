import AsyncStorage from '@react-native-async-storage/async-storage';

import { EDITORIAL_SHELF_KEY } from '@/api/storage';

import {
  isEditorialArticleShelved,
  loadEditorialShelf,
  setEditorialArticleShelved,
} from './editorialShelfStorage';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);

describe('editorial shelf storage', () => {
  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-12T09:00:00.000Z'));
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('adds once, preserves the first added time, and removes by catalog ID', async () => {
    await setEditorialArticleShelved('hero', true);
    jest.setSystemTime(new Date('2026-09-12T10:00:00.000Z'));
    await setEditorialArticleShelved('hero', true);

    expect(await loadEditorialShelf()).toEqual([
      {
        articleId: 'hero',
        addedAt: '2026-09-12T09:00:00.000Z',
      },
    ]);
    expect(await isEditorialArticleShelved('hero')).toBe(true);

    await setEditorialArticleShelved('hero', false);
    expect(await loadEditorialShelf()).toEqual([]);
    expect(await isEditorialArticleShelved('hero')).toBe(false);
  });

  it('sorts, de-duplicates, and ignores bad or retired catalog records', async () => {
    await AsyncStorage.setItem(
      EDITORIAL_SHELF_KEY,
      JSON.stringify([
        { articleId: 'hero', addedAt: '2026-09-10T08:00:00.000Z' },
        { articleId: 'missing', addedAt: '2026-09-12T08:00:00.000Z' },
        { articleId: 'a1', addedAt: '2026-09-11T08:00:00.000Z' },
        { articleId: 'hero', addedAt: '2026-09-09T08:00:00.000Z' },
        { articleId: 'a2', addedAt: 'not-a-date' },
        { nope: true },
      ]),
    );

    expect(await loadEditorialShelf()).toEqual([
      { articleId: 'a1', addedAt: '2026-09-11T08:00:00.000Z' },
      { articleId: 'hero', addedAt: '2026-09-10T08:00:00.000Z' },
    ]);
  });

  it('falls back safely for malformed JSON and rejects unknown writes', async () => {
    await AsyncStorage.setItem(EDITORIAL_SHELF_KEY, '{broken');
    expect(await loadEditorialShelf()).toEqual([]);
    await expect(setEditorialArticleShelved('missing', true)).rejects.toThrow(
      'Unknown editorial article: missing',
    );
  });
});

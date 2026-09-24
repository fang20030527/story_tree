import AsyncStorage from '@react-native-async-storage/async-storage';

import { requestSentenceTranslation } from '@/api/sentences';

import {
  loadEditorialTranslation,
  requestEditorialTranslation,
  saveEditorialTranslation,
  splitEditorialTranslationChunks,
} from './editorialTranslation';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/api/sentences', () => ({ requestSentenceTranslation: jest.fn() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('splits a long article into bounded, ordered source chunks', () => {
  const paragraphs = ['First paragraph.', 'x'.repeat(3_400), 'Last paragraph.'];
  const chunks = splitEditorialTranslationChunks(paragraphs);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 3_000)).toBe(true);
  expect(chunks[0]).toContain('First paragraph.');
  expect(chunks.at(-1)).toContain('Last paragraph.');
});

it('generates Chinese text in source order and caches it only for unchanged prose', async () => {
  const paragraphs = ['A'.repeat(2_900), 'B'.repeat(2_900), 'C'.repeat(2_900)];
  jest.mocked(requestSentenceTranslation).mockImplementation(async (source) => {
    if (source.startsWith('A')) await new Promise((resolve) => setTimeout(resolve, 10));
    return source.startsWith('A') ? '第一段译文。'
      : source.startsWith('B') ? '第二段译文。' : '第三段译文。';
  });
  const onProgress = jest.fn();
  const translated = await requestEditorialTranslation(paragraphs, onProgress);
  expect(translated).toBe('第一段译文。\n\n第二段译文。\n\n第三段译文。');
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(3);
  expect(onProgress.mock.calls).toEqual([[2, 3], [3, 3]]);
  await saveEditorialTranslation('article', paragraphs, translated);
  expect(await loadEditorialTranslation('article', paragraphs)).toBe(translated);
  expect(await loadEditorialTranslation('article', [...paragraphs, 'New paragraph.'])).toBeNull();
});

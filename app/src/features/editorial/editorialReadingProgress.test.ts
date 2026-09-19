import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadEditorialReadingProgress, saveEditorialReadingProgress } from './editorialReadingProgress';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => { await AsyncStorage.clear(); });

it('merges concurrent scroll and highlight writes and isolates articles', async () => {
  await Promise.all([
    saveEditorialReadingProgress('hero', { addedWords: [' Parker '] }),
    saveEditorialReadingProgress('hero', { scrollY: 780, showFullTranslation: true }),
    saveEditorialReadingProgress('hero', { addedWords: ['parker', 'chicks'] }),
  ]);
  expect(await loadEditorialReadingProgress('hero')).toEqual({
    addedWords: ['parker', 'chicks'], scrollY: 780, showFullTranslation: true,
  });
  expect(await loadEditorialReadingProgress('n1')).toEqual({
    addedWords: [], scrollY: 0, showFullTranslation: false,
  });
});

it('waits for pending writes when immediately reopening an article', async () => {
  const save = saveEditorialReadingProgress('hero', { scrollY: 912 });
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(912);
  await save;
});

it('recovers from malformed data and a failed write without blocking later saves', async () => {
  await AsyncStorage.setItem('context_reader_editorial_progress_v1_hero', '{bad');
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(0);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk failure'));
  await expect(saveEditorialReadingProgress('hero', { scrollY: 10 })).rejects.toThrow('disk failure');
  await saveEditorialReadingProgress('hero', { scrollY: 20 });
  expect((await loadEditorialReadingProgress('hero')).scrollY).toBe(20);
});

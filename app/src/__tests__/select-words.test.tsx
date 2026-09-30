import React from 'react';
import type { VocabularyWord } from '@context-reader/contracts';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { getVocabularyWords } from '@/api/practices';
import { saveVocabularyDraft } from '@/features/practice/practiceStorage';
import SelectWordsScreen from '@/app/practice/select-words';
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('@/api/practices', () => ({ getVocabularyWords: jest.fn() }));
jest.mock('@/features/practice/practiceStorage', () => ({ saveVocabularyDraft: jest.fn() }));
const words = Array.from({ length: 11 }, (_, index) => ({ wordId: String(index), term: `word${index}`, meaningZh: `词义${index}`, sourceSentence: index ? null : 'A real sentence.' } as VocabularyWord));
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(getVocabularyWords).mockResolvedValue({ items: words, nextCursor: null } as Awaited<ReturnType<typeof getVocabularyWords>>);
  jest.mocked(saveVocabularyDraft).mockResolvedValue();
});
it('limits selections to ten and preserves the real meanings and source sentence', async () => {
  const view = await render(<SelectWordsScreen />);
  await waitFor(() => expect(view.getByLabelText('选择 word0')).toBeTruthy());
  for (let index = 0; index < 11; index++) await fireEvent.press(view.getByLabelText(`选择 word${index}`));
  expect(view.getByText('每次自定义练习最多选择 10 个词')).toBeTruthy();
  await fireEvent.press(view.getByText('确认选词（10）'));
  expect(saveVocabularyDraft).toHaveBeenCalledWith(words.slice(0, 10).map(word => ({ term: word.term, meaningZh: word.meaningZh, sourceSentence: word.sourceSentence ?? '' })));
  expect(router.push).toHaveBeenCalledWith('/practice/new');
});
it('shows load errors and retries before letting the user confirm', async () => {
  jest.mocked(getVocabularyWords).mockRejectedValueOnce(new Error('网络中断'));
  const view = await render(<SelectWordsScreen />);
  await waitFor(() => expect(view.getByText('网络中断')).toBeTruthy());
  await fireEvent.press(view.getByText('重试'));
  await waitFor(() => expect(view.getByLabelText('选择 word0')).toBeTruthy());
});

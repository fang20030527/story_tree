import { act, renderHook } from '@testing-library/react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

import { loadEditorialReadingProgress, saveEditorialReadingProgress } from './editorialReadingProgress';
import { useEditorialReadingProgress } from './useEditorialReadingProgress';

jest.mock('./editorialReadingProgress', () => ({
  loadEditorialReadingProgress: jest.fn(),
  saveEditorialReadingProgress: jest.fn(() => Promise.resolve()),
}));

it('restores a saved position when layout finishes before the progress read', async () => {
  let finishLoad!: (progress: { scrollY: number; showFullTranslation: boolean; addedWords: string[] }) => void;
  jest.mocked(loadEditorialReadingProgress).mockReturnValueOnce(new Promise((resolve) => {
    finishLoad = resolve;
  }));
  const scrollTo = jest.fn();
  const { result, unmount } = await renderHook(() => useEditorialReadingProgress('older-article'));
  result.current.scrollRef.current = { scrollTo } as unknown as ScrollView;

  await act(() => {
    result.current.onLayout(600);
    result.current.onContentSizeChange(4_000);
  });
  expect(scrollTo).not.toHaveBeenCalled();

  await act(async () => finishLoad({ scrollY: 1_200, showFullTranslation: true, addedWords: [] }));
  expect(result.current.loaded).toBe(true);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith({ y: 1_200, animated: false });
  await unmount();
});

it('keeps an early manual position when saved progress arrives later', async () => {
  let finishLoad!: (progress: { scrollY: number; showFullTranslation: boolean; addedWords: string[] }) => void;
  jest.mocked(loadEditorialReadingProgress).mockReturnValueOnce(new Promise((resolve) => {
    finishLoad = resolve;
  }));
  const scrollTo = jest.fn();
  const { result, unmount } = await renderHook(() => useEditorialReadingProgress('older-article'));
  result.current.scrollRef.current = { scrollTo } as unknown as ScrollView;

  await act(() => {
    result.current.onLayout(600);
    result.current.onContentSizeChange(4_000);
    result.current.onUserScrollStart();
    result.current.onScroll({ nativeEvent: { contentOffset: { y: 420 } } } as NativeSyntheticEvent<NativeScrollEvent>);
    result.current.toggleTranslation();
  });
  await act(async () => finishLoad({ scrollY: 1_200, showFullTranslation: false, addedWords: ['scarlet'] }));

  expect(result.current.loaded).toBe(true);
  expect(result.current.showFullTranslation).toBe(true);
  expect(result.current.addedWords.has('scarlet')).toBe(true);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(saveEditorialReadingProgress).toHaveBeenCalledWith('older-article', {
    scrollY: 420,
    showFullTranslation: true,
  });
  await unmount();
});

import type { PracticeDto } from '@context-reader/contracts';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { createVocabularyItem, recordAssistance, requestWordTranslation, getPractice } from '@/api/practices';
import PracticeReaderScreen from '@/app/practice/[id]/read';
import PracticeResultScreen from '@/app/practice/[id]/result';
import { createIdempotencyKey } from '@/api/installation';
import { loadReadingPosition, saveReadingPosition } from '@/features/practice/practiceStorage';

jest.mock('@/features/practice/usePracticeExitGuard', () => ({ usePracticeExitGuard: () => jest.requireActual('react').useCallback((action: () => void) => action(), []) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: jest.requireActual('@/constants/theme').themes.light,
  }),
}));
jest.mock('@/api/practices', () => ({
  getPractice: jest.fn(), createVocabularyItem: jest.fn(),
  recordAssistance: jest.fn(), requestWordTranslation: jest.fn(),
}));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn().mockResolvedValue('practice-word-key') }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: jest.fn() }));
jest.mock('@/features/practice/practiceStorage', () => ({
  loadReadingPosition: jest.fn(),
  saveReadingPosition: jest.fn(),
  clearActivePracticeId: jest.fn(),
}));
jest.mock('@/features/practice/useTranslation', () => ({
  useTranslation: () => ({ status: 'idle', visible: false }),
}));

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

function practice(id: string, title: string): PracticeDto {
  return {
    id,
    status: 'ready',
    modelName: 'test-model',
    remainingFreePractices: 2,
    failure: null,
    questions: [],
    article: {
      title,
      wordCount: 6,
      paragraphs: [{
        id: '33333333-3333-4333-8333-333333333333',
        position: 0,
        segments: [{ text: 'A reader studies this short article.', targetId: null }],
      }],
    },
  };
}

function deferredPractice() {
  let resolve!: (result: PracticeDto) => void;
  const promise = new Promise<PracticeDto>((done) => { resolve = done; });
  return { promise, resolve };
}

const first = practice(FIRST_ID, 'First article');
const second = practice(SECOND_ID, 'Second article');

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: FIRST_ID });
  jest.mocked(getPractice).mockResolvedValue(first);
  jest.mocked(saveReadingPosition).mockResolvedValue();
  jest.mocked(loadReadingPosition).mockResolvedValue(0);
});

it('clears the previous error immediately and shows loading while retrying', async () => {
  const retry = deferredPractice();
  jest.mocked(getPractice)
    .mockRejectedValueOnce(new Error('加载失败'))
    .mockReturnValueOnce(retry.promise);
  const view = await render(<PracticeReaderScreen />);
  expect(await view.findByText('加载失败')).toBeTruthy();

  await fireEvent.press(view.getByText('重试'));
  expect(view.queryByText('加载失败')).toBeNull();
  expect(view.getByLabelText('正在加载文章')).toBeTruthy();

  await act(async () => { retry.resolve(first); });
  expect(await view.findByText('First article')).toBeTruthy();
  expect(getPractice).toHaveBeenCalledTimes(2);
});

it('saves progress for each article even if both are at the same paragraph index', async () => {
  const next = deferredPractice();
  jest.mocked(getPractice).mockResolvedValueOnce(first).mockReturnValueOnce(next.promise);
  const view = await render(<PracticeReaderScreen />);
  await view.findByText('First article');
  const firstList = view.getByTestId('practice-reader-list');
  const visible = { viewableItems: [{ index: 0 }], changed: [] };
  await fireEvent(firstList, 'viewableItemsChanged', visible);
  await fireEvent(firstList, 'viewableItemsChanged', visible);
  expect(saveReadingPosition).toHaveBeenCalledTimes(1);
  expect(saveReadingPosition).toHaveBeenLastCalledWith(FIRST_ID, 0);

  jest.mocked(useLocalSearchParams).mockReturnValue({ id: SECOND_ID });
  await view.rerender(<PracticeReaderScreen />);
  expect(view.queryByText('First article')).toBeNull();
  expect(view.getByLabelText('正在加载文章')).toBeTruthy();
  await act(async () => { next.resolve(second); });
  await view.findByText('Second article');
  await fireEvent(view.getByTestId('practice-reader-list'), 'viewableItemsChanged', visible);
  expect(saveReadingPosition).toHaveBeenCalledTimes(2);
  expect(saveReadingPosition).toHaveBeenLastCalledWith(SECOND_ID, 0);
});

it('ignores a late response from the previous article after navigation', async () => {
  const previous = deferredPractice();
  jest.mocked(getPractice).mockReturnValueOnce(previous.promise).mockResolvedValueOnce(second);
  const view = await render(<PracticeReaderScreen />);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: SECOND_ID });
  await view.rerender(<PracticeReaderScreen />);
  expect(await view.findByText('Second article')).toBeTruthy();

  await act(async () => { previous.resolve({ ...first, status: 'generating', article: null }); });
  expect(view.getByText('Second article')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});

it('allows another retry after a retry also fails', async () => {
  jest.mocked(getPractice)
    .mockRejectedValueOnce(new Error('第一次失败'))
    .mockRejectedValueOnce(new Error('第二次失败'))
    .mockResolvedValueOnce(first);
  const view = await render(<PracticeReaderScreen />);
  await view.findByText('第一次失败');
  await fireEvent.press(view.getByText('重试'));
  expect(await view.findByText('第二次失败')).toBeTruthy();
  await fireEvent.press(view.getByText('重试'));
  await waitFor(() => expect(view.getByText('First article')).toBeTruthy());
});

it('clears result-page errors during retry and resets results when switching practices', async () => {
  const retry = deferredPractice();
  const next = deferredPractice();
  jest.mocked(getPractice)
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(retry.promise)
    .mockReturnValueOnce(next.promise);
  const view = await render(<PracticeResultScreen />);
  await view.findByText('暂时无法加载练习结果');
  await fireEvent.press(view.getByText('重试'));
  expect(view.queryByText('暂时无法加载练习结果')).toBeNull();
  expect(view.getByLabelText('正在加载练习结果')).toBeTruthy();
  await act(async () => { retry.resolve({ ...first, status: 'completed' }); });
  await view.findByText('练习完成');

  jest.mocked(useLocalSearchParams).mockReturnValue({ id: SECOND_ID });
  await view.rerender(<PracticeResultScreen />);
  expect(view.queryByText('练习完成')).toBeNull();
  expect(view.getByLabelText('正在加载练习结果')).toBeTruthy();
  await act(async () => { next.resolve({ ...second, status: 'generating', article: null }); });
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/practice/[id]/generating', params: { id: SECOND_ID },
  });
});


it('returns from a completed topic to its group instead of leaving the other articles', async () => {
  const group: NonNullable<PracticeDto['group']> = {
    id: FIRST_ID,
    articles: (['经济', '文化', '政治', '科技'] as const).map((topic) => ({
      id: SECOND_ID, topic, status: 'ready', title: topic, wordCount: 250, failureMessage: null,
    })),
  };
  jest.mocked(getPractice).mockResolvedValue({ ...first, status: 'completed', group });
  const view = await render(<PracticeResultScreen />);
  await fireEvent.press(await view.findByText('返回主题选择'));
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/practice/[id]/topics', params: { id: FIRST_ID } });
});

it.each([null, 'target-reader'])('opens and saves a word card for target %s', async (targetId) => {
  jest.mocked(createIdempotencyKey).mockResolvedValue('practice-word-key');
  jest.mocked(requestWordTranslation).mockResolvedValue({ term: 'reader', partOfSpeech: 'n.', meaningZh: '读者', phoneticUk: '/reader/' });
  jest.mocked(recordAssistance).mockResolvedValue({ recorded: true, hintMeaningZh: '读者', sourceSentence: 'An earlier reader.' });
  jest.mocked(createVocabularyItem).mockResolvedValue({} as Awaited<ReturnType<typeof createVocabularyItem>>);
  jest.mocked(getPractice).mockResolvedValue({ ...first, article: {
    ...first.article!, paragraphs: [{ id: 'paragraph', position: 0, segments: [
      { text: 'A ', targetId: null }, { text: 'reader', targetId },
      { text: ' studies this short article.', targetId: null },
    ] }],
  } });
  const view = await render(<PracticeReaderScreen />);
  await fireEvent.press(await view.findByText('reader'));
  expect(await view.findByText('读者')).toBeTruthy();
  expect(requestWordTranslation).toHaveBeenCalledWith({ term: 'reader', context: 'A reader studies this short article.' });
  if (targetId) {
    expect(recordAssistance).toHaveBeenCalledWith(FIRST_ID, { kind: 'word_hint', targetId }, 'practice-word-key');
    expect(view.getByText('An earlier reader.')).toBeTruthy();
  } else {
    expect(recordAssistance).not.toHaveBeenCalled();
  }
  await fireEvent.press(view.getByLabelText('加入生词本'));
  await waitFor(() => expect(createVocabularyItem).toHaveBeenCalledWith({
    term: 'reader', meaningZh: '读者', sourceSentence: 'A reader studies this short article.',
  }, 'practice-word-key'));
  expect(await view.findByLabelText('已加入生词本')).toBeTruthy();
});

it('restores the saved paragraph when reopening the reader', async () => {
  jest.mocked(loadReadingPosition).mockResolvedValue(1);
  jest.mocked(getPractice).mockResolvedValue({ ...first, article: { ...first.article!, paragraphs: [
    ...first.article!.paragraphs,
    { ...first.article!.paragraphs[0], id: 'another-paragraph', position: 1 },
  ] } });
  const view = await render(<PracticeReaderScreen />);
  await view.findByText('First article');
  expect(view.getByTestId('practice-reader-list').props.initialScrollIndex).toBe(1);
});

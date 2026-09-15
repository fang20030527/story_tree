import type { VocabularyWord, VocabularyWordPage } from '@context-reader/contracts';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';

import { ApiError } from '@/api/client';
import { getVocabularyWordContexts, getVocabularyWords } from '@/api/practices';
import { localReviewTime } from '@/features/practice/wordPresentation';

import WordsScreen from '../app/(tabs)/words';

let mockFocus: () => void | (() => void);
let mockBlur: void | (() => void);
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      mockFocus = callback;
      mockBlur = callback();
      return mockBlur;
    }, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/api/practices', () => ({ getVocabularyWords: jest.fn(), getVocabularyWordContexts: jest.fn() }));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));

const mockedGetWords = jest.mocked(getVocabularyWords);
const mockedGetContexts = jest.mocked(getVocabularyWordContexts);
const NOW = '2026-09-14T12:00:00.000Z';
let stateListeners: ((state: AppStateStatus) => void)[];

function word(term = 'bank', overrides: Partial<VocabularyWord> = {}): VocabularyWord {
  return {
    wordId: term,
    term,
    meaningZh: '银行',
    sourceSentence: 'She went to the bank.',
    contextCount: 1,
    reviewReason: 'new',
    nextReviewAt: NOW,
    practiceCount: 0,
    independentCorrectCount: 0,
    assistedCount: 0,
    lastPracticedAt: null,
    ...overrides,
  };
}
function page(items: VocabularyWord[] = [], overrides: Partial<VocabularyWordPage> = {}): VocabularyWordPage {
  return {
    items,
    nextCursor: null,
    evaluatedAt: NOW,
    nextRefreshAt: null,
    summary: { totalCount: items.length, dueCount: items.length, scheduledCount: 0 },
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetWords.mockReset();
  mockedGetContexts.mockReset();
  stateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateListeners.push(listener);
    return { remove: jest.fn() };
  });
  mockedGetWords.mockResolvedValue(page());
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('opens prioritized vocabulary setup even when no words are due', async () => {
  const view = await render(<WordsScreen />);
  await view.findByText('还没有云端生词');
  expect(view.getByTestId('due-word-count').props.children).toBe(0);
  expect(view.getByText('个单词待复习')).toBeTruthy();
  await fireEvent.press(view.getByText('创建主题短文'));
  expect(router.push).toHaveBeenLastCalledWith('/practice/from-vocabulary');
  await fireEvent.press(view.getByLabelText('录入新单词'));
  expect(router.push).toHaveBeenLastCalledWith('/practice/new');
});

it('uses complete server totals and filters on the server', async () => {
  const summary = { totalCount: 75, dueCount: 45, scheduledCount: 30 };
  const later = word('stable', { reviewReason: 'scheduled', nextReviewAt: '2026-09-16T12:30:00.000Z', practiceCount: 3, independentCorrectCount: 2, assistedCount: 1 });
  mockedGetWords.mockResolvedValueOnce(page([word()], { summary }))
    .mockResolvedValueOnce(page([later], { summary }))
    .mockResolvedValueOnce(page([word('fragile', { reviewReason: 'relearn' })], { summary }));
  const view = await render(<WordsScreen />);
  await view.findByText('bank');
  expect(view.getByTestId('due-word-count').props.children).toBe(45);
  expect(mockedGetWords).toHaveBeenLastCalledWith({ filter: 'all', limit: 30 });
  expect(view.queryByText('已掌握')).toBeNull();
  await fireEvent.press(view.getByText('未到时间'));
  await view.findByText('stable');
  expect(mockedGetWords).toHaveBeenLastCalledWith({ filter: 'scheduled', limit: 30 });
  expect(view.queryByText('bank')).toBeNull();
  expect(view.getByText(`下次复习 ${localReviewTime(later.nextReviewAt)}`)).toBeTruthy();
  expect(view.getByText(/练习 3 次 · 独立答对 2 次/u)).toBeTruthy();
  expect(view.getByTestId('due-word-count').props.children).toBe(45);
  await fireEvent.press(view.getByText('待复习'));
  await view.findByText('需要再巩固');
  expect(mockedGetWords).toHaveBeenLastCalledWith({ filter: 'due', limit: 30 });
});

it('loads multiple meanings on demand without creating multiple word cards', async () => {
  mockedGetWords.mockResolvedValue(page([word('bank', { contextCount: 2 })]));
  mockedGetContexts.mockResolvedValue({ wordId: 'bank', contexts: [
    { id: 'context-1', meaningZh: '银行', sourceSentence: 'She went to the bank.' },
    { id: 'context-2', meaningZh: '河岸', sourceSentence: 'They walked along the river bank.' },
  ] });
  const view = await render(<WordsScreen />);
  await view.findByText('bank');
  expect(mockedGetContexts).not.toHaveBeenCalled();
  expect(view.getByTestId('due-word-count').props.children).toBe(1);
  await fireEvent.press(view.getByLabelText('展开 bank 的已保存语境'));
  await view.findByText('河岸');
  expect(view.getAllByText('bank')).toHaveLength(1);
  expect(mockedGetContexts).toHaveBeenCalledWith('bank');
  await fireEvent.press(view.getByLabelText('收起 bank 的已保存语境'));
  expect(view.queryByText('河岸')).toBeNull();
  await fireEvent.press(view.getByLabelText('展开 bank 的已保存语境'));
  expect(mockedGetContexts).toHaveBeenCalledTimes(1);
});

it('retries failed context expansion while retaining the word', async () => {
  mockedGetWords.mockResolvedValue(page([word('bank', { contextCount: 2 })]));
  mockedGetContexts.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ wordId: 'bank', contexts: [{ id: 'context-2', meaningZh: '河岸', sourceSentence: null }] });
  const view = await render(<WordsScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByLabelText('展开 bank 的已保存语境'));
  await view.findByText('重试加载语境');
  expect(view.getByText('bank')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('重试加载 bank 的语境'));
  await view.findByText('河岸');
});

it('distinguishes a failed initial load from an empty vocabulary', async () => {
  mockedGetWords.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([word()]));
  const view = await render(<WordsScreen />);
  await view.findByText('暂时无法加载词库');
  expect(view.queryByText('还没有云端生词')).toBeNull();
  expect(view.getByTestId('due-word-count').props.children).toBe('—');
  await fireEvent.press(view.getByText('重试'));
  await view.findByText('bank');
});

it('keeps loaded words after pagination fails and retries the same cursor', async () => {
  mockedGetWords.mockResolvedValueOnce(page([word()], { nextCursor: 'page-two' }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page([word('shore')]));
  const view = await render(<WordsScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByText('加载更多'));
  await view.findByText('暂时无法加载词库');
  expect(view.getByText('bank')).toBeTruthy();
  expect(view.queryByText('还没有云端生词')).toBeNull();
  await fireEvent.press(view.getByText('重试'));
  await view.findByText('shore');
  expect(mockedGetWords).toHaveBeenLastCalledWith({ filter: 'all', cursor: 'page-two', limit: 30 });
  expect(view.getByText('bank')).toBeTruthy();
});

it('clears stale pages and reloads when vocabulary changes during pagination', async () => {
  mockedGetWords.mockResolvedValueOnce(page([word('old')], { nextCursor: 'stale' }))
    .mockRejectedValueOnce(new ApiError('VOCABULARY_CHANGED', '词库已更新', true))
    .mockResolvedValueOnce(page([word('fresh')]));
  const view = await render(<WordsScreen />);
  await view.findByText('old');
  await fireEvent.press(view.getByText('加载更多'));
  await view.findByText('fresh');
  expect(view.queryByText('old')).toBeNull();
  expect(mockedGetWords).toHaveBeenLastCalledWith({ filter: 'all', limit: 30 });
});

it('does not let a previous filter response replace the selected filter', async () => {
  const oldRequest = deferred<VocabularyWordPage>();
  mockedGetWords.mockReturnValueOnce(oldRequest.promise)
    .mockResolvedValueOnce(page([word('due-only')]));
  const view = await render(<WordsScreen />);
  await fireEvent.press(view.getByText('待复习'));
  await view.findByText('due-only');
  await act(async () => { oldRequest.resolve(page([word('old-filter')])); });
  expect(view.queryByText('old-filter')).toBeNull();
  expect(view.getByText('due-only')).toBeTruthy();
});

it('ignores a pending page from a previous filter', async () => {
  const pendingPage = deferred<VocabularyWordPage>();
  mockedGetWords.mockResolvedValueOnce(page([word()], { nextCursor: 'old-page' }))
    .mockReturnValueOnce(pendingPage.promise)
    .mockResolvedValueOnce(page([word('future', { reviewReason: 'scheduled' })]));
  const view = await render(<WordsScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByText('加载更多'));
  await fireEvent.press(view.getByText('未到时间'));
  await view.findByText('future');
  await act(async () => { pendingPage.resolve(page([word('stale-word')], { nextCursor: 'stale-next' })); });
  expect(view.queryByText('stale-word')).toBeNull();
  expect(view.queryByText('加载更多')).toBeNull();
});

it('shows a zero-due filter without claiming the entire vocabulary is empty', async () => {
  const summary = { totalCount: 4, dueCount: 0, scheduledCount: 4 };
  mockedGetWords.mockResolvedValueOnce(page([word('future', { reviewReason: 'scheduled' })], { summary }))
    .mockResolvedValueOnce(page([], { summary }))
    .mockResolvedValueOnce(page([word('future', { reviewReason: 'scheduled' })], { summary }));
  const view = await render(<WordsScreen />);
  await view.findByText('future');
  await fireEvent.press(view.getByText('待复习'));
  await view.findByText('当前没有待复习单词');
  expect(view.queryByText('还没有云端生词')).toBeNull();
  await fireEvent.press(view.getByText('查看全部词库'));
  await view.findByText('future');
  expect(mockedGetWords).toHaveBeenLastCalledWith({ filter: 'all', limit: 30 });
});

it('refreshes after returning to the page and foreground while keeping prior data on refresh failure', async () => {
  mockedGetWords.mockResolvedValueOnce(page([word()]))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page([word('refreshed')]));
  const view = await render(<WordsScreen />);
  await view.findByText('bank');
  await act(async () => { mockBlur?.(); mockFocus(); });
  await view.findByText('暂时无法加载词库');
  expect(view.getByText('bank')).toBeTruthy();
  await act(async () => {
    stateListeners.forEach((listener) => listener('background'));
    stateListeners.forEach((listener) => listener('active'));
  });
  await view.findByText('refreshed');
  expect(view.queryByText('bank')).toBeNull();
});

it('refreshes at the next server due time despite a skewed device clock', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-01T12:00:00Z'));
  mockedGetWords.mockResolvedValueOnce(page([word('future', { reviewReason: 'scheduled' })], { nextRefreshAt: '2026-09-14T12:00:01.000Z' }))
    .mockResolvedValueOnce(page([word('now-due', { reviewReason: 'due' })]));
  const view = await render(<WordsScreen />);
  await view.findByText('future');
  await act(async () => { jest.advanceTimersByTime(1_100); });
  await view.findByText('now-due');
  await waitFor(() => expect(mockedGetWords).toHaveBeenCalledTimes(2));
});

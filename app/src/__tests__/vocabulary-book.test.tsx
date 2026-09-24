import type { VocabularyWord, VocabularyWordPage } from '@context-reader/contracts';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';

import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  getVocabularyWordContexts,
  getVocabularyWords,
  markVocabularyWordMastered,
  restoreVocabularyWord,
} from '@/api/practices';
import { localReviewTime } from '@/features/practice/wordPresentation';

import VocabularyBookScreen from '../app/vocabulary/book';

let mockFocus: () => void | (() => void);
let mockBlur: void | (() => void);
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
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
jest.mock('@/api/practices', () => ({
  getVocabularyWords: jest.fn(),
  getVocabularyWordContexts: jest.fn(),
  markVocabularyWordMastered: jest.fn(),
  restoreVocabularyWord: jest.fn(),
}));
jest.mock('@/api/installation', () => ({
  InstallationCredentialUnavailableError: class InstallationCredentialUnavailableError extends Error {},
  createIdempotencyKey: jest.fn(),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));

const mockedGetWords = jest.mocked(getVocabularyWords);
const mockedGetContexts = jest.mocked(getVocabularyWordContexts);
const mockedMarkMastered = jest.mocked(markVocabularyWordMastered);
const mockedRestore = jest.mocked(restoreVocabularyWord);
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
    masteredAt: null,
    ...overrides,
  };
}
function page(items: VocabularyWord[] = [], overrides: Partial<VocabularyWordPage> = {}): VocabularyWordPage {
  return {
    items,
    nextCursor: null,
    evaluatedAt: NOW,
    nextRefreshAt: null,
    summary: {
      totalCount: items.length,
      todayCount: items.length,
      learningCount: 0,
      dueLearningCount: 0,
      unlearnedCount: items.length,
      masteredCount: 0,
    },
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
  jest.mocked(createIdempotencyKey).mockResolvedValue('mastery-key-fixed-1');
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

it('defaults to the learning category and requests it with the device time zone', async () => {
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('还没有云端生词');
  expect(mockedGetWords).toHaveBeenLastCalledWith(expect.objectContaining({
    filter: 'learning', limit: 30, timeZone: expect.any(String),
  }));
  await fireEvent.press(view.getByLabelText('录入新单词'));
  expect(router.push).toHaveBeenLastCalledWith('/practice/new');
  await fireEvent.press(view.getByLabelText('返回'));
  expect(router.back).toHaveBeenCalled();
});

it('shows elapsed loading without a fabricated percentage and resets it when retrying', async () => {
  jest.useFakeTimers();
  const first = deferred<VocabularyWordPage>();
  const retry = deferred<VocabularyWordPage>();
  mockedGetWords.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const view = await render(<VocabularyBookScreen />);
  expect(view.getByRole('progressbar').props.accessibilityValue).toEqual({ text: '加载中' });
  expect(view.getByText('已等待 0 秒')).toBeTruthy();
  await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
  expect(view.getByText('已等待 8 秒')).toBeTruthy();
  expect(view.getByText('连接比平时慢，请稍候；超时后可以重试。')).toBeTruthy();
  await act(async () => { first.reject(new ApiError('REQUEST_TIMEOUT', '连接超时', true)); });
  expect(view.queryByRole('progressbar')).toBeNull();
  await fireEvent.press(view.getByText('重试'));
  expect(view.getByText('已等待 0 秒')).toBeTruthy();
  await act(async () => { retry.resolve(page([word()])); });
  expect(view.queryByRole('progressbar')).toBeNull();
  expect(view.getByText('bank')).toBeTruthy();
});

it('shows whole-library counts on the four category chips', async () => {
  const summary = {
    totalCount: 75, todayCount: 4, learningCount: 30,
    dueLearningCount: 9, unlearnedCount: 40, masteredCount: 5,
  };
  mockedGetWords.mockResolvedValueOnce(page([word()], { summary }));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  expect(view.getByText('今日新增 4')).toBeTruthy();
  expect(view.getByText('在学 30')).toBeTruthy();
  expect(view.getByText('未学 40')).toBeTruthy();
  expect(view.getByText('已掌握 5')).toBeTruthy();
});

it('filters on the server when switching categories', async () => {
  const later = word('stable', { reviewReason: 'scheduled', nextReviewAt: '2026-09-16T12:30:00.000Z', practiceCount: 3, independentCorrectCount: 2, assistedCount: 1 });
  mockedGetWords.mockResolvedValueOnce(page([word()]))
    .mockResolvedValueOnce(page([later]))
    .mockResolvedValueOnce(page([word('fragile', { reviewReason: 'relearn' })]));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByText(/^今日新增/u));
  await view.findByText('stable');
  expect(mockedGetWords).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'today' }));
  expect(view.queryByText('bank')).toBeNull();
  expect(view.getByText(`下次复习 ${localReviewTime(later.nextReviewAt)}`)).toBeTruthy();
  expect(view.getByText(/练习 3 次 · 独立答对 2 次/u)).toBeTruthy();
  await fireEvent.press(view.getByText(/^已掌握/u));
  await view.findByText('需要再巩固');
  expect(mockedGetWords).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'mastered' }));
});

it('loads multiple meanings on demand without creating multiple word cards', async () => {
  mockedGetWords.mockResolvedValue(page([word('bank', { contextCount: 2 })]));
  mockedGetContexts.mockResolvedValue({ wordId: 'bank', contexts: [
    { id: 'context-1', meaningZh: '银行', sourceSentence: 'She went to the bank.' },
    { id: 'context-2', meaningZh: '河岸', sourceSentence: 'They walked along the river bank.' },
  ] });
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  expect(mockedGetContexts).not.toHaveBeenCalled();
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
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByLabelText('展开 bank 的已保存语境'));
  await view.findByText('重试加载语境');
  expect(view.getByText('bank')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('重试加载 bank 的语境'));
  await view.findByText('河岸');
});

it('distinguishes a failed initial load from an empty vocabulary', async () => {
  mockedGetWords.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([word()]));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('暂时无法加载词库');
  expect(view.queryByText('还没有云端生词')).toBeNull();
  await fireEvent.press(view.getByText('重试'));
  await view.findByText('bank');
});

it('keeps loaded words after pagination fails and retries the same cursor', async () => {
  mockedGetWords.mockResolvedValueOnce(page([word()], { nextCursor: 'page-two' }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page([word('shore')]));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByText('加载更多'));
  await view.findByText('暂时无法加载词库');
  expect(view.getByText('bank')).toBeTruthy();
  expect(view.queryByText('还没有云端生词')).toBeNull();
  await fireEvent.press(view.getByText('重试'));
  await view.findByText('shore');
  expect(mockedGetWords).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'learning', cursor: 'page-two' }));
  expect(view.getByText('bank')).toBeTruthy();
});

it('clears stale pages and reloads when vocabulary changes during pagination', async () => {
  mockedGetWords.mockResolvedValueOnce(page([word('old')], { nextCursor: 'stale' }))
    .mockRejectedValueOnce(new ApiError('VOCABULARY_CHANGED', '词库已更新', true))
    .mockResolvedValueOnce(page([word('fresh')]));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('old');
  await fireEvent.press(view.getByText('加载更多'));
  await view.findByText('fresh');
  expect(view.queryByText('old')).toBeNull();
  expect(mockedGetWords).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'learning', limit: 30 }));
});

it('does not let a previous filter response replace the selected filter', async () => {
  const oldRequest = deferred<VocabularyWordPage>();
  mockedGetWords.mockReturnValueOnce(oldRequest.promise)
    .mockResolvedValueOnce(page([word('due-only')]));
  const view = await render(<VocabularyBookScreen />);
  await fireEvent.press(view.getByText(/^未学/u));
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
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByText('加载更多'));
  await fireEvent.press(view.getByText(/^今日新增/u));
  await view.findByText('future');
  await act(async () => { pendingPage.resolve(page([word('stale-word')], { nextCursor: 'stale-next' })); });
  expect(view.queryByText('stale-word')).toBeNull();
  expect(view.queryByText('加载更多')).toBeNull();
});

it('shows an empty category without claiming the entire vocabulary is empty', async () => {
  const summary = {
    totalCount: 4, todayCount: 0, learningCount: 0,
    dueLearningCount: 0, unlearnedCount: 4, masteredCount: 0,
  };
  mockedGetWords.mockResolvedValueOnce(page([word('future', { reviewReason: 'scheduled' })], { summary }))
    .mockResolvedValueOnce(page([], { summary }))
    .mockResolvedValueOnce(page([word('future', { reviewReason: 'scheduled' })], { summary }));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('future');
  await fireEvent.press(view.getByText(/^今日新增/u));
  await view.findByText('今天还没有新增单词');
  expect(view.queryByText('还没有云端生词')).toBeNull();
  await fireEvent.press(view.getByText('查看在学单词'));
  await view.findByText('future');
  expect(mockedGetWords).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'learning', limit: 30 }));
});

it('refreshes after returning to the page and foreground while keeping prior data on refresh failure', async () => {
  mockedGetWords.mockResolvedValueOnce(page([word()]))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page([word('refreshed')]));
  const view = await render(<VocabularyBookScreen />);
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
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('future');
  await act(async () => { jest.advanceTimersByTime(1_100); });
  await view.findByText('now-due');
  await waitFor(() => expect(mockedGetWords).toHaveBeenCalledTimes(2));
});

it('marks a word mastered with one key per tap and refreshes the list and counts', async () => {
  const summary = {
    totalCount: 2, todayCount: 0, learningCount: 1,
    dueLearningCount: 1, unlearnedCount: 0, masteredCount: 1,
  };
  mockedGetWords.mockResolvedValueOnce(page([word()]))
    .mockResolvedValueOnce(page([word('other', { masteredAt: NOW })], { summary }));
  mockedMarkMastered.mockResolvedValue({ wordId: 'bank', masteredAt: NOW });
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByLabelText('标记 bank 已掌握'));
  await waitFor(() => expect(mockedMarkMastered).toHaveBeenCalledWith('bank', 'mastery-key-fixed-1'));
  await view.findByText('other');
  expect(mockedGetWords).toHaveBeenCalledTimes(2);
  expect(view.getByText('已掌握')).toBeTruthy();
  expect(view.getByText('在学 1')).toBeTruthy();
});

it('restores a mastered word back into the learning lists', async () => {
  const mastered = word('bank', { masteredAt: NOW });
  mockedGetWords.mockResolvedValueOnce(page([mastered]))
    .mockResolvedValueOnce(page([word('bank')]));
  mockedRestore.mockResolvedValue({ wordId: 'bank', masteredAt: null });
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByLabelText('恢复学习 bank'));
  await waitFor(() => expect(mockedRestore).toHaveBeenCalledWith('bank', 'mastery-key-fixed-1'));
  expect(mockedMarkMastered).not.toHaveBeenCalled();
  await waitFor(() => expect(mockedGetWords).toHaveBeenCalledTimes(2));
});

it('keeps the word and shows a Chinese error when the mastery update fails', async () => {
  mockedGetWords.mockResolvedValue(page([word()]));
  mockedMarkMastered.mockRejectedValue(new ApiError('NETWORK_ERROR', '网络连接失败', true));
  const view = await render(<VocabularyBookScreen />);
  await view.findByText('bank');
  await fireEvent.press(view.getByLabelText('标记 bank 已掌握'));
  await view.findByText('网络连接失败');
  expect(view.getByText('bank')).toBeTruthy();
  expect(mockedGetWords).toHaveBeenCalledTimes(1);
});

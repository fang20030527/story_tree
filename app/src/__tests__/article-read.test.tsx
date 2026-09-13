import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { getImportedArticle } from '@/api/articles';
import { ApiError } from '@/api/client';
import {
  getArticleTranslation,
  requestArticleTranslation,
} from '@/api/imports';
import { createIdempotencyKey } from '@/api/installation';
import { recordImportedRecentView } from '@/features/library/libraryStorage';

import ArticleReadScreen from '@/app/article-read';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({
    id: '11111111-1111-4111-8111-111111111111',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));
jest.mock('@/api/articles', () => ({ getImportedArticle: jest.fn() }));
jest.mock('@/api/imports', () => ({
  getArticleTranslation: jest.fn(),
  requestArticleTranslation: jest.fn(),
}));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn() }));
jest.mock('@/features/library/libraryStorage', () => ({
  isFavorite: jest.fn().mockResolvedValue(false),
  recordImportedRecentView: jest.fn(),
  recordRecentView: jest.fn(),
  toggleFavorite: jest.fn().mockResolvedValue(false),
}));

const mockedGetArticle = jest.mocked(getImportedArticle);
const mockedRequestTranslation = jest.mocked(requestArticleTranslation);
const mockedGetTranslation = jest.mocked(getArticleTranslation);
const mockedCreateKey = jest.mocked(createIdempotencyKey);
const mockedRecordRecent = jest.mocked(recordImportedRecentView);
const article = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceKind: 'paste' as const,
  sourceUrl: null,
  title: 'Private article',
  wordCount: 800,
  importedAt: '2026-09-12T08:00:00.000Z',
  paragraphs: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      position: 0,
      text: 'Careful readers preserve the source context.',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      position: 1,
      text: 'They revise a conclusion when evidence changes.',
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetArticle.mockResolvedValue(article);
  mockedCreateKey.mockResolvedValue('translation-key-01');
  mockedRecordRecent.mockResolvedValue(undefined);
});

afterEach(() => jest.useRealTimers());

it('records the private view without favorite or import header actions', async () => {
  const view = await render(<ArticleReadScreen />);
  await waitFor(() => expect(view.getByText('Private article')).toBeTruthy());
  expect(view.queryByLabelText('收藏文章')).toBeNull();
  expect(view.queryByLabelText('取消收藏')).toBeNull();
  expect(view.queryByLabelText('导入新文章')).toBeNull();
  expect(mockedRecordRecent).toHaveBeenCalledWith({
    articleId: article.id,
    title: article.title,
    sourceKind: article.sourceKind,
    wordCount: article.wordCount,
  });
});

it('offers a shelf recovery action when the initial article is gone', async () => {
  mockedGetArticle.mockRejectedValueOnce(
    new ApiError('NOT_FOUND', '文章不存在', false),
  );
  const view = await render(<ArticleReadScreen />);
  await waitFor(() => expect(view.getByText('文章已删除')).toBeTruthy());
  await fireEvent.press(view.getByText('返回书架'));
  expect(router.replace).toHaveBeenCalledWith('/shelf');
});

it('switches to deleted recovery when a translation poll loses the article', async () => {
  jest.useFakeTimers();
  mockedRequestTranslation.mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    status: 'queued',
    scope: 'full',
    paragraphId: null,
    translatedTextZh: null,
    pollAfterMs: 1_000,
    failure: null,
  });
  mockedGetTranslation.mockRejectedValue(
    new ApiError('NOT_FOUND', '文章不存在', false),
  );
  const view = await render(<ArticleReadScreen />);
  await waitFor(() => expect(view.getByText('Private article')).toBeTruthy());
  await fireEvent.press(view.getByText('查看译文'));
  await waitFor(() => expect(mockedRequestTranslation).toHaveBeenCalled());
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
  });
  await waitFor(() => expect(view.getByText('文章已删除')).toBeTruthy());
  expect(view.queryByText('翻译暂时无法完成')).toBeNull();
});

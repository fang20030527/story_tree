import { router } from 'expo-router';
import { markEditorialArticleRead } from './editorialReadStorage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { recordEditorialRecentView } from '@/features/library/libraryStorage';
import {
  isEditorialArticleShelved,
  setEditorialArticleShelved,
} from '@/features/shelf/editorialShelfStorage';

import { EditorialReadScreen } from './EditorialReadScreen';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));
jest.mock('@/features/library/libraryStorage', () => ({
  recordEditorialRecentView: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/shelf/editorialShelfStorage', () => ({
  isEditorialArticleShelved: jest.fn(),
  setEditorialArticleShelved: jest.fn(),
}));

jest.mock('./editorialReadStorage', () => ({ markEditorialArticleRead: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.mocked(markEditorialArticleRead).mockResolvedValue(undefined);
});

it('renders catalog prose and records one editorial recent view', async () => {
  const view = await render(<EditorialReadScreen articleId="hero" />);
  expect(
    view.getByText('World’s Oldest Evidence of Habitual Drug Use Found in Ancient Teeth'),
  ).toBeTruthy();
  expect(
    view.getByText(/Researchers say marks and chemical traces/u),
  ).toBeTruthy();
  await waitFor(() =>
    expect(recordEditorialRecentView).toHaveBeenCalledWith('hero'),
  );
  expect(isEditorialArticleShelved).not.toHaveBeenCalled();
  expect(setEditorialArticleShelved).not.toHaveBeenCalled();
});

it('does not record an invalid ID', async () => {
  const view = await render(<EditorialReadScreen articleId="missing" />);
  expect(view.getByText('文章不存在')).toBeTruthy();
  expect(recordEditorialRecentView).not.toHaveBeenCalled();
  expect(isEditorialArticleShelved).not.toHaveBeenCalled();
  expect(setEditorialArticleShelved).not.toHaveBeenCalled();
});


it('saves completion before leaving and prevents duplicate submissions', async () => {
  let finish!: () => void;
  jest.mocked(markEditorialArticleRead).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const view = await render(<EditorialReadScreen articleId="hero" />);
  expect(markEditorialArticleRead).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('完成学习'));
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(markEditorialArticleRead).toHaveBeenCalledTimes(1);
  expect(markEditorialArticleRead).toHaveBeenCalledWith('hero');
  expect(router.back).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('stays in the reader on save failure and allows retry', async () => {
  jest.mocked(markEditorialArticleRead).mockRejectedValueOnce(new Error('storage failed'));
  const view = await render(<EditorialReadScreen articleId="a1" />);
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(view.getByText('已读状态保存失败，请重试')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(markEditorialArticleRead).toHaveBeenLastCalledWith('a1');
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('returns to the editorial list when opened without navigation history', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(false);
  const view = await render(<EditorialReadScreen articleId="hero" />);
  await fireEvent.press(view.getByLabelText('完成学习'));
  expect(router.replace).toHaveBeenCalledWith('/');
});

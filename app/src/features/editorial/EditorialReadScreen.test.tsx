import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { recordEditorialRecentView } from '@/features/library/libraryStorage';
import {
  isEditorialArticleShelved,
  setEditorialArticleShelved,
} from '@/features/shelf/editorialShelfStorage';

import { EditorialReadScreen } from './EditorialReadScreen';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
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

beforeEach(() => jest.clearAllMocks());

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

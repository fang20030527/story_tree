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
    view.getByText('Why Millions Watch Sweden’s Slow Moose Migration'),
  ).toBeTruthy();
  expect(
    view.getByText(/Every spring, cameras beside a northern river/u),
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

it('renders all four original economic indicator charts', async () => {
  const view = await render(
    <EditorialReadScreen articleId="economist-2026-09-19-0b132742-d39d-4c6b-86ad-d3a6c738c04b" />,
  );
  expect(view.getAllByLabelText(/Economic data, commodities and markets，原刊配图/)).toHaveLength(4);
});

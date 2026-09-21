import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { EditorialReadBadge } from './EditorialReadBadge';
import { isEditorialArticleRead, markEditorialArticleRead } from './editorialReadStorage';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: require('@/constants/theme').themes.light }),
}));

beforeEach(async () => { await AsyncStorage.clear(); });

it('updates a visible badge after completion and restores it on remount', async () => {
  const view = await render(<EditorialReadBadge articleId="hero" />);
  expect(view.queryByText('已读')).toBeNull();
  await act(async () => { await markEditorialArticleRead('hero'); });
  expect(view.getByText('已读')).toBeTruthy();
  expect(await isEditorialArticleRead('a1')).toBe(false);
  await view.unmount();
  const reopened = await render(<EditorialReadBadge articleId="hero" />);
  await waitFor(() => expect(reopened.getByText('已读')).toBeTruthy());
});

it('does not publish a read badge if persistence fails', async () => {
  const view = await render(<EditorialReadBadge articleId="hero" />);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage failed'));
  await act(async () => {
    await expect(markEditorialArticleRead('hero')).rejects.toThrow('storage failed');
  });
  expect(view.queryByText('已读')).toBeNull();
  expect(await isEditorialArticleRead('hero')).toBe(false);
});

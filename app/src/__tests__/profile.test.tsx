import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { loadAuthUser } from '@/features/auth/authStorage';
import { loadRecentViews } from '@/features/library/libraryStorage';

import ProfileScreen from '@/app/(tabs)/profile';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: require('@/constants/theme').themes.light,
    preference: 'light',
    setPreference: jest.fn(),
  }),
}));
jest.mock('@/features/auth/authStorage', () => ({ loadAuthUser: jest.fn() }));
jest.mock('@/features/library/libraryStorage', () => ({
  loadFavorites: jest.fn().mockResolvedValue([]),
  loadRecentViews: jest.fn(),
}));

it('keeps recent learning statistics but removes favorite concepts', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  jest.mocked(loadRecentViews).mockResolvedValue([{
    kind: 'editorial', articleId: 'hero',
    timestamp: '2026-09-12T08:00:00.000Z',
  }]);
  const view = await render(<ProfileScreen />);
  await waitFor(() => expect(view.getByText('学习篇数')).toBeTruthy());
  expect(view.getByText('最近观看')).toBeTruthy();
  expect(view.queryByText('我的收藏')).toBeNull();
  expect(view.queryByText('收藏')).toBeNull();
});

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { router } from 'expo-router';

import { clearAuthUser, loadAuthUser } from '@/features/auth/authStorage';
import { loadRecentViews } from '@/features/library/libraryStorage';

import ProfileScreen from '@/app/(tabs)/profile';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
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
jest.mock('@/features/auth/authStorage', () => ({
  clearAuthUser: jest.fn(),
  loadAuthUser: jest.fn(),
}));
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

it('opens login on top of the profile after logout so it can be dismissed', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue({
    userId: '11111111-1111-4111-8111-111111111111',
    kind: 'registered',
    remainingFreePractices: 3,
  });
  jest.mocked(loadRecentViews).mockResolvedValue([]);
  jest.mocked(clearAuthUser).mockResolvedValue(undefined);

  const view = await render(<ProfileScreen />);
  await waitFor(() => expect(view.getByText('退出登录')).toBeTruthy());

  await fireEvent.press(view.getByText('退出登录'));

  await waitFor(() => expect(clearAuthUser).toHaveBeenCalledTimes(1));
  expect(router.push).toHaveBeenCalledWith('/login');
  expect(router.replace).not.toHaveBeenCalled();
});

it('saves the practice word count and restores it after reopening profile', async () => {
  const view = await render(<ProfileScreen />);
  await waitFor(() => expect(view.getByLabelText('每次练习单词数量').props.value).not.toBe(''));
  await fireEvent.changeText(view.getByLabelText('每次练习单词数量'), '30');
  await fireEvent.press(view.getByText('保存'));
  await view.findByText('已保存，下次生成练习时生效');
  await view.unmount();
  const reopened = await render(<ProfileScreen />);
  await waitFor(() => expect(reopened.getByLabelText('每次练习单词数量').props.value).toBe('30'));
});
it('rejects zero without changing the saved setting', async () => {
  const view = await render(<ProfileScreen />);
  await waitFor(() => expect(view.getByLabelText('每次练习单词数量').props.value).not.toBe(''));
  await fireEvent.changeText(view.getByLabelText('每次练习单词数量'), '0');
  await fireEvent.press(view.getByText('保存'));
  expect(await view.findByText('请输入大于 0 的整数')).toBeTruthy();
});

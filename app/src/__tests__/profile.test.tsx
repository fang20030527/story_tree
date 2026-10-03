import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

import { router } from 'expo-router';

import { getAccountProfile } from '@/api/account';
import { clearAuthUser, loadAuthUser } from '@/features/auth/authStorage';
import { loadRecentViews } from '@/features/library/libraryStorage';

import ProfileScreen from '@/app/(tabs)/profile';

jest.mock('@/context/LearningModeContext', () => ({ useLearningMode: () => ({ mode: 'read', setMode: jest.fn() }) }));

it('显示实际本地日期、累计学习时长和十分钟打卡，并跨年刷新', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 11, 31, 23, 59, 55));
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  jest.mocked(loadRecentViews).mockResolvedValue([]);
  await AsyncStorage.setItem('study-time:v1:guest', JSON.stringify({ '2026-12-31': 660_000 }));
  const view = await render(<ProfileScreen />);
  try {
    await waitFor(() => expect(view.getByText('今日已学 11min')).toBeTruthy());
    expect(view.getByText('学习日志')).toBeTruthy();
    expect(view.getByLabelText('2026-12-31 今日 已打卡，学习 11 分钟')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    await waitFor(() => expect(view.getByText('学习日志')).toBeTruthy());
    expect(view.getByLabelText('2027-01-01 今日，学习 0 分钟')).toBeTruthy();
    expect(view.getByText('今日已学 0min')).toBeTruthy();
  } finally {
    await view.unmount();
    jest.useRealTimers();
    await AsyncStorage.removeItem('study-time:v1:guest');
  }
});

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
jest.mock('@/api/practices', () => ({ getVocabularyWords: jest.fn().mockResolvedValue({ summary: { totalCount: 9, masteredCount: 2 } }) }));
jest.mock('@/api/account', () => ({
  getAccountProfile: jest.fn().mockResolvedValue({ kind: 'registered', username: 'zhangsan' }),
}));
jest.mock('@/features/auth/authStorage', () => ({
  clearAuthUser: jest.fn(),
  loadAuthUser: jest.fn(),
}));
jest.mock('@/features/library/libraryStorage', () => ({
  loadFavorites: jest.fn().mockResolvedValue([]),
  loadRecentViews: jest.fn(),
}));

it('opens the Pro detail page from the upgrade entry', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  jest.mocked(loadRecentViews).mockResolvedValue([]);
  const view = await render(<ProfileScreen />);
  await fireEvent.press(view.getByLabelText('升级为 VIP 版'));
  expect(router.push).toHaveBeenCalledWith('/pro');
  expect(view.queryByText('2025 特惠')).toBeNull();
});

it('keeps recent learning statistics but removes favorite concepts', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  jest.mocked(loadRecentViews).mockResolvedValue([{
    kind: 'editorial', articleId: 'hero',
    timestamp: '2026-09-12T08:00:00.000Z',
  }]);
  const view = await render(<ProfileScreen />);
  await waitFor(() => expect(view.getByText('近期阅读')).toBeTruthy());
  expect(view.getByText('最近阅读')).toBeTruthy();
  expect(view.getByText('我的收藏')).toBeTruthy();
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
  expect(await view.findByText('请输入 1–32 的整数')).toBeTruthy();
});

describe('用户名', () => {
  const registered = { userId: '11111111-1111-4111-8111-111111111111', kind: 'registered' as const, remainingFreePractices: 3 };
  beforeEach(() => {
    jest.mocked(router.push).mockClear();
    jest.mocked(loadRecentViews).mockResolvedValue([]);
    jest.mocked(getAccountProfile).mockReset().mockResolvedValue({ kind: 'registered', username: 'zhangsan' });
  });

  it('已登录时显示账号的用户名，并可进入修改页', async () => {
    jest.mocked(loadAuthUser).mockResolvedValue(registered);
    const view = await render(<ProfileScreen />);
    expect(await view.findByText('zhangsan')).toBeTruthy();
    expect(view.queryByText('阅读者')).toBeNull();
    await fireEvent.press(view.getByLabelText('修改用户名'));
    expect(router.push).toHaveBeenCalledWith('/username');
  });

  it('未登录时不读取账号资料，也没有修改入口', async () => {
    jest.mocked(loadAuthUser).mockResolvedValue(null);
    const view = await render(<ProfileScreen />);
    await waitFor(() => expect(view.getByText('未登录')).toBeTruthy());
    expect(getAccountProfile).not.toHaveBeenCalled();
    expect(view.queryByLabelText('修改用户名')).toBeNull();
  });

  it('用户名读取失败时保留原来的称呼，不显示修改入口', async () => {
    jest.mocked(loadAuthUser).mockResolvedValue(registered);
    jest.mocked(getAccountProfile).mockRejectedValue(new Error('offline'));
    const view = await render(<ProfileScreen />);
    await waitFor(() => expect(getAccountProfile).toHaveBeenCalled());
    expect(await view.findByText('阅读者')).toBeTruthy();
    expect(view.queryByLabelText('修改用户名')).toBeNull();
  });
});

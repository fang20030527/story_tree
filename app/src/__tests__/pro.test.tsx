import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import ProScreen from '@/app/pro';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));

beforeEach(() => jest.clearAllMocks());

it('explains purchase availability and expands pricing details', async () => {
  const view = await render(<ProScreen />);
  expect(view.getByText('Pro 暂未开放购买 · 当前不会扣费')).toBeTruthy();
  await fireEvent.press(view.getByText('Pro 的价格和额度是多少？'));
  expect(view.getByText(/价格、使用额度及会员专属功能尚未公布/)).toBeTruthy();
  await fireEvent.press(view.getByText('Pro 的价格和额度是多少？'));
  expect(view.queryByText(/价格、使用额度及会员专属功能尚未公布/)).toBeNull();
});

it('opens the existing feature guide', async () => {
  const view = await render(<ProScreen />);
  await fireEvent.press(view.getByText('查看当前功能与使用方法'));
  expect(router.push).toHaveBeenCalledWith('/feature-guide');
});

it('returns to the previous screen when opened from profile', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(true);
  const view = await render(<ProScreen />);
  await fireEvent.press(view.getByText('继续学习'));
  expect(router.back).toHaveBeenCalledTimes(1);
});

it('returns to profile when opened directly without navigation history', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(false);
  const view = await render(<ProScreen />);
  await fireEvent.press(view.getByLabelText('返回'));
  expect(router.replace).toHaveBeenCalledWith('/(tabs)/profile');
});

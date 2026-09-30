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

it('shows the planned membership without enabling payment or fake redemption', async () => {
  const view = await render(<ProScreen />);
  expect(view.getByText(/VIP 暂未开放购买/)).toBeTruthy();
  expect(view.getByText('暂未开放开通').parent?.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(view.getByText('月度会员'));
  await fireEvent.press(view.getByText('邀请码兑换'));
  expect(view.getByLabelText('邀请码').props.editable).toBe(false);
  expect(view.getByText(/当前不会验证或保存邀请码/)).toBeTruthy();
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

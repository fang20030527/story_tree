import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

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
const mockMode = { mode: 'read', setMode: jest.fn() };
jest.mock('@/context/LearningModeContext', () => ({ useLearningMode: () => mockMode }));

beforeEach(() => {
  jest.clearAllMocks();
  mockMode.mode = 'read';
  jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => { jest.restoreAllMocks(); });

it.each([
  { platform: 'ios', prices: [22, 148, 228], label: 'App Store 价格', monthlyDaily: '0.73', annualDaily: '0.41' },
  { platform: 'web', prices: [19, 128, 198], label: '网页端价格', monthlyDaily: '0.63', annualDaily: '0.35' },
  { platform: 'android', prices: [19, 128, 198], label: '会员价格', monthlyDaily: '0.63', annualDaily: '0.35' },
] as const)('keeps $platform prices consistent across cards, selected totals and terms', async ({ platform, prices, label, monthlyDaily, annualDaily }) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const view = await render(<ProScreen />);
  expect(view.getByText(`${label} · 阅读与口语同享`)).toBeTruthy();
  for (const price of prices) expect(view.getByText(String(price))).toBeTruthy();
  const names = ['月度会员', '年度会员', '永久会员'];
  for (const [index, name] of names.entries()) {
    await fireEvent.press(view.getByLabelText(name));
    expect(view.getByLabelText(name).props.accessibilityState.selected).toBe(true);
    expect(view.getByText(`¥${prices[index]}`)).toBeTruthy();
    if (index < 2) {
      expect(view.getByTestId('vip-plan-summary').props.children).toContain(index === 0 ? monthlyDaily : annualDaily);
    } else {
      expect(view.getByTestId('vip-plan-summary').props.children).toBe('一次开通 · 长期有效');
    }
    await fireEvent.press(view.getByText('订阅说明'));
    expect(view.getByText(new RegExp(`${name}拟定价格 ¥${prices[index]}`))).toBeTruthy();
    expect(view.getByText(/当前方案不自动续费/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('关闭'));
  }
});

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

it('defaults to the current mode and keeps mode and plan when browsing benefits', async () => {
  mockMode.mode = 'speak';
  const view = await render(<ProScreen />);
  expect(view.getByLabelText('口语权益 11').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('台词 AI 讲解')).toBeTruthy();
  expect(view.getByText('App 内播放 YouTube 视频')).toBeTruthy();
  expect(view.getByTestId('vip-plan-summary').props.children).toContain('0.73');
  await fireEvent.press(view.getByLabelText('年度会员'));
  expect(view.getByTestId('vip-plan-summary').props.children).toContain('0.41');
  await fireEvent.press(view.getByLabelText('阅读权益 4'));
  expect(view.getByText('智能阅读陪练')).toBeTruthy();
  expect(view.queryByText('录音跟读')).toBeNull();
  expect(mockMode.setMode).not.toHaveBeenCalled();
  expect(view.getByLabelText('年度会员').props.accessibilityState.selected).toBe(true);
});

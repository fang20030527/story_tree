import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';

import { ApiError } from '@/api/client';
import { loginWithEmail } from '@/api/email';
import { registerAnonymous } from '@/api/practices';
import LoginScreen from '@/app/login';
import { clearAuthUser } from '@/features/auth/authStorage';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));
jest.mock('@/api/email', () => ({
  loginWithEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  confirmPasswordReset: jest.fn(),
}));
jest.mock('@/api/practices', () => ({ registerAnonymous: jest.fn() }));
jest.mock('@/features/auth/authStorage', () => ({
  clearAuthUser: jest.fn(),
  saveAuthUserEmail: jest.fn(),
}));

const registered = {
  userId: '22222222-2222-4222-8222-222222222222',
  kind: 'registered' as const,
  remainingFreePractices: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(registerAnonymous).mockResolvedValue({} as never);
});

async function submit() {
  const view = await render(<LoginScreen />);
  await fireEvent.changeText(view.getByPlaceholderText('邮箱地址'), 'reader@example.com');
  await fireEvent.changeText(view.getByPlaceholderText('密码（至少 8 个字符）'), 'correct-horse-battery');
  await fireEvent.press(view.getByLabelText('邮箱登录或注册'));
  return view;
}

it('游客已有学习记录时提示无法合并，确认后改用新的游客身份登录已有账号', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(loginWithEmail)
    .mockRejectedValueOnce(new ApiError('AUTH_ACCOUNT_CONFLICT', '当前设备已有数据，请先完成账号合并', false))
    .mockResolvedValueOnce({ ...registered, created: false });
  const view = await submit();

  await waitFor(() => expect(alert).toHaveBeenCalledWith('这台设备上有游客学习记录', expect.any(String), expect.any(Array)));
  expect(clearAuthUser).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  // The dead-end server message is not shown: the dialog offers the way out instead.
  expect(view.queryByText('当前设备已有数据，请先完成账号合并')).toBeNull();

  const buttons = alert.mock.calls[0]![2]!;
  expect(buttons.map((button) => button.text)).toEqual(['取消', '继续登录']);
  await act(async () => { buttons.find((button) => button.text === '继续登录')!.onPress?.(); });

  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(clearAuthUser).toHaveBeenCalledTimes(1);
  expect(registerAnonymous).toHaveBeenCalledTimes(2);
  expect(loginWithEmail).toHaveBeenCalledTimes(2);
  expect(jest.mocked(clearAuthUser).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(registerAnonymous).mock.invocationCallOrder[1]!);
  alert.mockRestore();
  await view.unmount();
});

it('取消后留在登录页，不清除本机游客身份', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(loginWithEmail)
    .mockRejectedValueOnce(new ApiError('AUTH_ACCOUNT_CONFLICT', '当前设备已有数据，请先完成账号合并', false));
  const view = await submit();
  await waitFor(() => expect(alert).toHaveBeenCalled());
  alert.mock.calls[0]![2]!.find((button) => button.style === 'cancel')!.onPress?.();
  expect(clearAuthUser).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  expect(view.getByLabelText('邮箱登录或注册')).toBeTruthy();
  alert.mockRestore();
  await view.unmount();
});

it('新建账号时提示已创建，便于发现输错的邮箱；登录已有账号时不提示', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(loginWithEmail).mockResolvedValueOnce({ ...registered, created: true });
  let view = await submit();
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  expect(alert).toHaveBeenCalledWith('已创建新账号', expect.stringContaining('reader@example.com'));
  await view.unmount();

  alert.mockClear();
  jest.mocked(loginWithEmail).mockResolvedValueOnce({ ...registered, created: false });
  view = await submit();
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(2));
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
  await view.unmount();
});

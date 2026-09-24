import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { confirmPasswordReset, requestPasswordReset } from '@/api/email';
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requestPasswordReset).mockResolvedValue({
    message: '如果该邮箱已注册，重置验证码将发送至邮箱',
  });
  jest.mocked(confirmPasswordReset).mockResolvedValue({
    message: '密码已重置，请重新登录',
  });
  jest.mocked(clearAuthUser).mockResolvedValue(undefined);
});

it('lets a reader request a code and reset the password from the login screen', async () => {
  const view = await render(<LoginScreen />);
  await fireEvent.press(view.getByText('忘记密码？'));
  await fireEvent.changeText(view.getByPlaceholderText('邮箱地址'), 'Reader@Example.com');
  await fireEvent.press(view.getByLabelText('发送验证码'));

  await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('reader@example.com'));
  await view.findByPlaceholderText('12 位邮箱验证码');
  await fireEvent.changeText(view.getByPlaceholderText('12 位邮箱验证码'), 'abcd efgh jklm');
  await fireEvent.changeText(view.getByPlaceholderText('新密码（至少 8 个字符）'), 'new-password-123');
  await fireEvent.changeText(view.getByPlaceholderText('再次输入新密码'), 'new-password-123');
  await fireEvent.press(view.getByLabelText('提交新密码'));

  await waitFor(() => expect(confirmPasswordReset).toHaveBeenCalledWith(
    'reader@example.com', 'ABCDEFGHJKLM', 'new-password-123',
  ));
  await waitFor(() => expect(clearAuthUser).toHaveBeenCalledTimes(1));
  expect(await view.findByText('密码已重置，请重新登录')).toBeTruthy();
  await view.unmount();
});

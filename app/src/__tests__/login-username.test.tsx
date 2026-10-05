import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import { ApiError } from '@/api/client';
import { loginWithEmail } from '@/api/email';
import { registerAnonymous } from '@/api/practices';
import LoginScreen from '@/app/login';

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
  jest.mocked(loginWithEmail).mockResolvedValue({ ...registered, created: false });
});

async function fillCredentials(view: Awaited<ReturnType<typeof render>>, username?: string) {
  await fireEvent.changeText(view.getByPlaceholderText('邮箱地址'), 'reader@example.com');
  await fireEvent.changeText(view.getByPlaceholderText('密码（至少 8 个字符）'), 'correct-horse-battery');
  if (username !== undefined) await fireEvent.changeText(view.getByPlaceholderText('用户名（新用户选填）'), username);
}

it('用户名选填：留空时请求不带用户名，保持原有登录注册流程', async () => {
  const view = await render(<LoginScreen />);
  await fillCredentials(view);
  await fireEvent.press(view.getByLabelText('邮箱登录或注册'));

  await waitFor(() => expect(loginWithEmail).toHaveBeenCalledWith('reader@example.com', 'correct-horse-battery', undefined));
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  await view.unmount();
});

it('填写用户名时去掉空白并规范化后提交', async () => {
  const view = await render(<LoginScreen />);
  await fillCredentials(view, '  Ａlice  ');
  await fireEvent.press(view.getByLabelText('邮箱登录或注册'));

  await waitFor(() => expect(loginWithEmail).toHaveBeenCalledWith('reader@example.com', 'correct-horse-battery', 'Alice'));
  await view.unmount();
});

it('纯空白的用户名视为没有填写', async () => {
  const view = await render(<LoginScreen />);
  await fillCredentials(view, '    ');
  await fireEvent.press(view.getByLabelText('邮箱登录或注册'));

  await waitFor(() => expect(loginWithEmail).toHaveBeenCalledWith('reader@example.com', 'correct-horse-battery', undefined));
  await view.unmount();
});

it.each([
  ['a', '用户名需为 2–24 个字符'],
  ['a'.repeat(25), '用户名需为 2–24 个字符'],
  ['reader@example.com', '用户名只能包含文字、数字、下划线、点、连字符和间隔号'],
  ['..', '用户名需至少包含一个文字或数字'],
  ['Admin', '这个用户名不可使用，请换一个'],
])('用户名 %s 不合法时不发请求并给出提示', async (username, message) => {
  const view = await render(<LoginScreen />);
  await fillCredentials(view, username);
  await fireEvent.press(view.getByLabelText('邮箱登录或注册'));

  expect(await view.findByText(message)).toBeTruthy();
  expect(registerAnonymous).not.toHaveBeenCalled();
  expect(loginWithEmail).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  await view.unmount();
});

it('用户名已被占用时显示服务端提示，留在页面并保留已填内容', async () => {
  jest.mocked(loginWithEmail).mockRejectedValue(
    new ApiError('STATE_CONFLICT', '这个用户名已被使用，请换一个', false),
  );
  const view = await render(<LoginScreen />);
  await fillCredentials(view, 'Alice');
  await fireEvent.press(view.getByLabelText('邮箱登录或注册'));

  expect(await view.findByText('这个用户名已被使用，请换一个')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  expect(view.getByPlaceholderText('用户名（新用户选填）').props.value).toBe('Alice');
  expect(view.getByPlaceholderText('邮箱地址').props.value).toBe('reader@example.com');
  await view.unmount();
});

it('说明用户名只用于新账号、会公开显示且之后可修改；找回密码时不显示该输入框', async () => {
  const view = await render(<LoginScreen />);
  expect(view.getByText(/仅创建新账号时使用，会公开显示在留言瓶/u)).toBeTruthy();
  expect(view.getByText(/之后可在「我的」中修改/u)).toBeTruthy();

  await fireEvent.press(view.getByText('忘记密码？'));
  expect(view.queryByPlaceholderText('用户名（新用户选填）')).toBeNull();
  await view.unmount();
});

it('在用户名输入框按完成键同样提交', async () => {
  const view = await render(<LoginScreen />);
  await fillCredentials(view, 'Alice');
  await fireEvent(view.getByPlaceholderText('用户名（新用户选填）'), 'submitEditing');

  await waitFor(() => expect(loginWithEmail).toHaveBeenCalledWith('reader@example.com', 'correct-horse-battery', 'Alice'));
  await view.unmount();
});

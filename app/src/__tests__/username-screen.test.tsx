import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

import { getAccountProfile, updateUsername } from '@/api/account';
import { ApiError } from '@/api/client';
import UsernameScreen from '@/app/username';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/context/ThemeContext', () => ({
  useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }),
}));
jest.mock('@/api/account', () => ({ getAccountProfile: jest.fn(), updateUsername: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAccountProfile).mockResolvedValue({ kind: 'registered', username: 'zhangsan' });
  jest.mocked(updateUsername).mockImplementation(async username => ({ kind: 'registered', username }));
});

async function ready() {
  const view = await render(<UsernameScreen />);
  const input = await view.findByLabelText('用户名');
  return { view, input };
}

it('读取当前用户名并预填，说明它会公开显示', async () => {
  const { view, input } = await ready();
  expect(input.props.value).toBe('zhangsan');
  expect(view.getByText(/会显示在留言瓶等公开位置/u)).toBeTruthy();
  expect(view.getByText(/不区分大小写，不能与他人重复/u)).toBeTruthy();
  await view.unmount();
});

it('修改后保存：规范化名字提交到服务端并返回上一页', async () => {
  const { view, input } = await ready();
  await fireEvent.changeText(input, '  Ａlice_2  ');
  await fireEvent.press(view.getByLabelText('保存'));

  await waitFor(() => expect(updateUsername).toHaveBeenCalledWith('Alice_2'));
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  await view.unmount();
});

it('名字没有变化时不发请求，直接返回', async () => {
  const { view } = await ready();
  await fireEvent.press(view.getByLabelText('保存'));
  expect(updateUsername).not.toHaveBeenCalled();
  expect(router.back).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it.each([
  ['', '请输入用户名'],
  ['a', '用户名需为 2–24 个字符'],
  ['a b', '用户名只能包含文字、数字、下划线、点、连字符和间隔号'],
  ['__', '用户名需至少包含一个文字或数字'],
  ['管理员', '这个用户名不可使用，请换一个'],
])('名字 %j 不合法时给出提示且不保存', async (value, message) => {
  const { view, input } = await ready();
  await fireEvent.changeText(input, value);
  await fireEvent.press(view.getByLabelText('保存'));

  expect(await view.findByText(message)).toBeTruthy();
  expect(updateUsername).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
  await view.unmount();
});

it('名字被占用时显示服务端提示，保留输入以便修改', async () => {
  jest.mocked(updateUsername).mockRejectedValue(new ApiError('STATE_CONFLICT', '这个用户名已被使用，请换一个', false));
  const { view, input } = await ready();
  await fireEvent.changeText(input, 'alice');
  await fireEvent.press(view.getByLabelText('保存'));

  expect(await view.findByText('这个用户名已被使用，请换一个')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  expect(view.getByLabelText('用户名').props.value).toBe('alice');
  await fireEvent.changeText(view.getByLabelText('用户名'), 'alice_2');
  expect(view.queryByText('这个用户名已被使用，请换一个')).toBeNull();
  await view.unmount();
});

it('保存期间防止重复提交', async () => {
  let finish!: () => void;
  jest.mocked(updateUsername).mockReturnValue(new Promise(resolve => {
    finish = () => resolve({ kind: 'registered', username: 'Alice' });
  }));
  const { view, input } = await ready();
  await fireEvent.changeText(input, 'Alice');
  await fireEvent.press(view.getByLabelText('保存'));
  await fireEvent.press(view.getByLabelText('保存'));

  await waitFor(() => expect(updateUsername).toHaveBeenCalledTimes(1));
  finish();
  await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  await view.unmount();
});

it('游客提示先登录，并可跳转到登录页', async () => {
  jest.mocked(getAccountProfile).mockResolvedValue({ kind: 'guest', username: null });
  const view = await render(<UsernameScreen />);
  expect(await view.findByText('登录后才能设置用户名。')).toBeTruthy();
  expect(view.queryByLabelText('用户名')).toBeNull();
  await fireEvent.press(view.getByLabelText('去登录'));
  expect(router.replace).toHaveBeenCalledWith('/login');
  await view.unmount();
});

it('读取失败时显示原因，可重试', async () => {
  jest.mocked(getAccountProfile)
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true))
    .mockResolvedValueOnce({ kind: 'registered', username: 'zhangsan' });
  const view = await render(<UsernameScreen />);
  expect(await view.findByText('网络连接失败')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('重试'));
  expect((await view.findByLabelText('用户名')).props.value).toBe('zhangsan');
  await view.unmount();
});

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import {
  blockMessageBottleAuthor, createMessageBottle, getMessageBottleProfile, getMessageBottles, reportMessageBottle,
} from '@/api/messageBottles';
import { MessageBottleScreen } from './MessageBottleScreen';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => (() => void) | void) => { jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]); },
}));
jest.mock('@/api/practices', () => ({ registerAnonymous: jest.fn().mockResolvedValue({}) }));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn() }));
jest.mock('@/api/messageBottles', () => ({
  createMessageBottle: jest.fn(), getMessageBottleProfile: jest.fn(), getMessageBottles: jest.fn(),
  reportMessageBottle: jest.fn(), blockMessageBottleAuthor: jest.fn(),
}));
jest.mock('@/components/confirm', () => ({
  confirmAction: (_options: unknown, onConfirm: () => void) => onConfirm(), notify: jest.fn(),
}));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/brand', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BrandHeader: () => null, PageHeading: ({ title }: { title: string }) => React.createElement(Text, null, title) };
});

const message = { id: '11111111-1111-4111-8111-111111111111', username: '小张', content: '希望增加阅读统计。', createdAt: '2026-10-03T01:00:00.000Z', isMine: false, status: 'visible' as const };
const own = { ...message, id: '22222222-2222-4222-8222-222222222222', username: '小林', content: '希望增加听力练习。', isMine: true };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getMessageBottles).mockReset().mockResolvedValue({ items: [message], nextCursor: null });
  jest.mocked(getMessageBottleProfile).mockReset().mockResolvedValue({ username: '小林', canPost: true });
  jest.mocked(createMessageBottle).mockReset().mockResolvedValue(own);
  jest.mocked(createIdempotencyKey).mockReset().mockResolvedValue('operation-key-000001');
});

it('游客查看所有实名留言，并通过入口登录后投递', async () => {
  jest.mocked(getMessageBottleProfile).mockResolvedValue({ username: null, canPost: false });
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByText(message.content)).toBeTruthy());
  expect(screen.getByText('小张')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '登录后投递留言' }));
  expect(router.push).toHaveBeenCalledWith('/login');
  expect(createMessageBottle).not.toHaveBeenCalled();
});
it('已有署名时显示公开署名，并可进入修改用户名页', async () => {
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByText('公开署名')).toBeTruthy());
  expect(screen.getAllByText('小林').length).toBeGreaterThan(0);
  expect(screen.queryByLabelText('用户名')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '修改用户名' }));
  expect(router.push).toHaveBeenCalledWith('/username');
});
it('首次设置用户名，提交成功后公开署名并清空内容', async () => {
  jest.mocked(getMessageBottleProfile).mockResolvedValue({ username: null, canPost: true });
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByLabelText('用户名')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('用户名'), '小林');
  await fireEvent.changeText(screen.getByLabelText('留言内容'), own.content);
  await fireEvent.press(screen.getByRole('button', { name: '投递留言' }));
  await waitFor(() => expect(screen.getByText('留言已投递，谢谢你的反馈。')).toBeTruthy());
  expect(createMessageBottle).toHaveBeenCalledWith({ username: '小林', content: own.content }, 'operation-key-000001');
  expect(screen.getByLabelText('留言内容').props.value).toBe('');
  expect(screen.getByText('我')).toBeTruthy();
  expect(screen.queryByLabelText('用户名')).toBeNull();
});
it('网络失败保留草稿，同一内容重试使用原幂等键', async () => {
  jest.mocked(createMessageBottle).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true)).mockResolvedValueOnce(own);
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByLabelText('留言内容')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('留言内容'), own.content);
  await fireEvent.press(screen.getByRole('button', { name: '投递留言' }));
  await waitFor(() => expect(screen.getByText('网络连接失败')).toBeTruthy());
  expect(screen.getByLabelText('留言内容').props.value).toBe(own.content);
  await fireEvent.press(screen.getByRole('button', { name: '投递留言' }));
  await waitFor(() => expect(createMessageBottle).toHaveBeenCalledTimes(2));
  expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  expect(jest.mocked(createMessageBottle).mock.calls.map(call => call[1])).toEqual(['operation-key-000001', 'operation-key-000001']);
});
it('提交中禁止重复发送，空白内容不能投递', async () => {
  let complete!: (value: typeof own) => void;
  jest.mocked(createMessageBottle).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByLabelText('留言内容')).toBeTruthy());
  const button = () => screen.getByRole('button', { name: '投递留言' });
  await fireEvent.changeText(screen.getByLabelText('留言内容'), '  \n ');
  expect(button().props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('留言内容'), own.content);
  await fireEvent.press(button()); await fireEvent.press(button());
  await waitFor(() => expect(createMessageBottle).toHaveBeenCalledTimes(1));
  expect(button().props.accessibilityState.disabled).toBe(true);
  complete(own);
  await waitFor(() => expect(screen.getByText('留言已投递，谢谢你的反馈。')).toBeTruthy());
});
it('历史留言读取失败可用原游标重试，追加结果不会重复', async () => {
  const cursor = `${message.createdAt}_${message.id}`;
  jest.mocked(getMessageBottles).mockResolvedValueOnce({ items: [message], nextCursor: cursor })
    .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true))
    .mockResolvedValueOnce({ items: [message, own], nextCursor: null });
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByRole('button', { name: '加载更多留言' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '加载更多留言' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '重试加载' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '重试加载' }));
  await waitFor(() => expect(screen.getByText(own.content)).toBeTruthy());
  expect(screen.getAllByText(message.content)).toHaveLength(1);
  expect(getMessageBottles).toHaveBeenNthCalledWith(2, cursor);
  expect(getMessageBottles).toHaveBeenNthCalledWith(3, cursor);
});
it('无留言时显示真实空状态，读取失败提供重试', async () => {
  jest.mocked(getMessageBottles).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByText('网络连接失败')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '重试读取留言' }));
  await waitFor(() => expect(screen.getByText('还没有留言，来投递第一只留言瓶吧。')).toBeTruthy());
});
it('重放较早的已发布留言时仍按最新时间排列', async () => {
  jest.mocked(createMessageBottle).mockResolvedValue({ ...own, createdAt: '2026-10-02T01:00:00.000Z' });
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByLabelText('留言内容')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('留言内容'), own.content);
  await fireEvent.press(screen.getByRole('button', { name: '投递留言' }));
  await waitFor(() => expect(screen.getByText('留言已投递，谢谢你的反馈。')).toBeTruthy());
  expect(screen.getAllByText(/希望增加/).map(node => node.props.children)).toEqual([message.content, own.content]);
});
it('先审后发：投递后提示等待审核，自己的留言标明审核中', async () => {
  jest.mocked(createMessageBottle).mockResolvedValue({ ...own, status: 'pending' });
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByLabelText('留言内容')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('留言内容'), own.content);
  await fireEvent.press(screen.getByRole('button', { name: '投递留言' }));
  await waitFor(() => expect(screen.getByText('留言已提交，审核通过后所有人都能看到。')).toBeTruthy());
  expect(screen.getByText('审核中 · 仅自己可见')).toBeTruthy();
});
it('举报别人的留言后它立即从列表消失', async () => {
  jest.mocked(reportMessageBottle).mockResolvedValue();
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByText(message.content)).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '举报或屏蔽 小张 的留言' }));
  await fireEvent.press(screen.getByRole('button', { name: '举报这条留言' }));
  await fireEvent.press(screen.getByRole('button', { name: '辱骂骚扰' }));
  await waitFor(() => expect(screen.queryByText(message.content)).toBeNull());
  expect(reportMessageBottle).toHaveBeenCalledWith(message.id, { reason: 'abuse' });
});
it('屏蔽作者后看不到对方的留言，自己的留言没有举报入口', async () => {
  jest.mocked(getMessageBottles).mockResolvedValueOnce({ items: [message, own], nextCursor: null })
    .mockResolvedValue({ items: [own], nextCursor: null });
  jest.mocked(blockMessageBottleAuthor).mockResolvedValue();
  const screen = await render(<MessageBottleScreen />);
  await waitFor(() => expect(screen.getByText(message.content)).toBeTruthy());
  expect(screen.queryByRole('button', { name: '举报或屏蔽 小林 的留言' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '举报或屏蔽 小张 的留言' }));
  await fireEvent.press(screen.getByRole('button', { name: '屏蔽「小张」' }));
  await waitFor(() => expect(screen.queryByText(message.content)).toBeNull());
  expect(blockMessageBottleAuthor).toHaveBeenCalledWith(message.id);
  expect(screen.getByText(own.content)).toBeTruthy();
});

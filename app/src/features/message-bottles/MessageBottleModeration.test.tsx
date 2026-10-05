import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/api/client';
import { getModerationBottles, moderateMessageBottle, saveMessageBottleReply, deleteMessageBottleReply } from '@/api/messageBottleDeveloper';
import { MessageBottleModeration } from './MessageBottleModeration';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | void) => { jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]); },
}));
jest.mock('@/api/messageBottleDeveloper', () => ({
  getModerationBottles: jest.fn(), moderateMessageBottle: jest.fn(), moderateMessageBottleAuthor: jest.fn(),
  saveMessageBottleReply: jest.fn(), deleteMessageBottleReply: jest.fn(),
}));
jest.mock('@/components/confirm', () => ({ confirmAction: (_options: unknown, run: () => void) => run() }));
jest.mock('@/context/ThemeContext', () => ({ useAppTheme: () => ({ theme: jest.requireActual('@/constants/theme').themes.light }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const item = {
  id: '11111111-1111-4111-8111-111111111111', username: '读者', content: '希望增加阅读统计', createdAt: '2026-10-05T00:00:00.000Z',
  status: 'pending' as const, reviewedAt: null, author: { id: '22222222-2222-4222-8222-222222222222', username: '读者', banned: false },
  reports: [], reply: null,
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getModerationBottles).mockResolvedValue({ view: 'pending', items: [item], nextCursor: null });
  jest.mocked(moderateMessageBottle).mockResolvedValue({ ok: true });
  jest.mocked(saveMessageBottleReply).mockResolvedValue({ reply: { content: '已经安排', createdAt: item.createdAt, updatedAt: item.createdAt } });
  jest.mocked(deleteMessageBottleReply).mockResolvedValue({ reply: null });
});
it('审核通过后刷新列表，支持切换被举报筛选', async () => {
  const screen = await render(<MessageBottleModeration onExit={jest.fn()} onRevoke={jest.fn()} />);
  await waitFor(() => expect(screen.getByText(item.content)).toBeTruthy());
  jest.mocked(getModerationBottles).mockResolvedValue({ view: 'pending', items: [], nextCursor: null });
  await fireEvent.press(screen.getByRole('button', { name: '通过并公开' }));
  await waitFor(() => expect(screen.queryByText(item.content)).toBeNull());
  expect(moderateMessageBottle).toHaveBeenCalledWith(item.id, 'approve');
  await fireEvent.press(screen.getByRole('button', { name: '被举报' }));
  await waitFor(() => expect(getModerationBottles).toHaveBeenLastCalledWith('reported'));
});
it('回复失败保留草稿，重试成功刷新，空白不可发送', async () => {
  jest.mocked(saveMessageBottleReply).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true))
    .mockResolvedValueOnce({ reply: { content: '已经安排', createdAt: item.createdAt, updatedAt: item.createdAt } });
  const screen = await render(<MessageBottleModeration onExit={jest.fn()} onRevoke={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '回复留言' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '回复留言' }));
  await fireEvent.changeText(screen.getByLabelText('开发者回复内容'), '  ');
  expect(screen.getByRole('button', { name: '保存回复' }).props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('开发者回复内容'), '已经安排');
  await fireEvent.press(screen.getByRole('button', { name: '保存回复' }));
  await waitFor(() => expect(screen.getByText('网络连接失败')).toBeTruthy());
  expect(screen.getByLabelText('开发者回复内容').props.value).toBe('已经安排');
  await fireEvent.press(screen.getByRole('button', { name: '保存回复' }));
  await waitFor(() => expect(screen.queryByLabelText('开发者回复内容')).toBeNull());
  expect(saveMessageBottleReply).toHaveBeenCalledTimes(2);
});
it('可以编辑和删除现有回复', async () => {
  jest.mocked(getModerationBottles).mockResolvedValue({ view: 'recent', items: [{ ...item,
    reply: { content: '原来的回复', createdAt: item.createdAt, updatedAt: item.createdAt },
  }], nextCursor: null });
  const screen = await render(<MessageBottleModeration onExit={jest.fn()} onRevoke={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('原来的回复')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '修改回复' }));
  expect(screen.getByLabelText('开发者回复内容').props.value).toBe('原来的回复');
  await fireEvent.press(screen.getByRole('button', { name: '取消回复' }));
  await fireEvent.press(screen.getByRole('button', { name: '删除回复' }));
  await waitFor(() => expect(deleteMessageBottleReply).toHaveBeenCalledWith(item.id));
});
it('权限撤销后清空审核内容并退出，不能停留查看旧数据', async () => {
  const onRevoke = jest.fn();
  const screen = await render(<MessageBottleModeration onExit={jest.fn()} onRevoke={onRevoke} />);
  await waitFor(() => expect(screen.getByText(item.content)).toBeTruthy());
  jest.mocked(moderateMessageBottle).mockRejectedValue(new ApiError('DEVELOPER_REQUIRED', '此操作需要开发者账号权限', false));
  await fireEvent.press(screen.getByRole('button', { name: '通过并公开' }));
  await waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(item.content)).toBeNull();
});

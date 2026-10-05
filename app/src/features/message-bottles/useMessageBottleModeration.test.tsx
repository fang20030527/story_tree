import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { MessageBottleModerationPage } from '@context-reader/contracts';
import { getModerationBottles } from '@/api/messageBottleDeveloper';
import { useMessageBottleModeration } from './useMessageBottleModeration';

let mockFocused = true;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]);
  },
}));
jest.mock('@/api/messageBottleDeveloper', () => ({ getModerationBottles: jest.fn() }));
const item = {
  id: '11111111-1111-4111-8111-111111111111', username: '读者', content: '只有审核员能看见的待审留言', createdAt: '2026-10-05T00:00:00.000Z',
  status: 'pending' as const, reviewedAt: null, author: { id: '22222222-2222-4222-8222-222222222222', username: '读者', banned: false },
  reports: [], reply: null,
};
const page: MessageBottleModerationPage = { view: 'pending', items: [item], nextCursor: null };
beforeEach(() => { mockFocused = true; jest.resetAllMocks(); });

it('离开页面后丢弃迟到响应，重新进入时不会显示上个会话的审核数据', async () => {
  let finish!: (page: MessageBottleModerationPage) => void;
  jest.mocked(getModerationBottles).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ view: 'pending', items: [], nextCursor: null });
  const revoke = jest.fn();
  const hook = await renderHook(() => useMessageBottleModeration(revoke));
  mockFocused = false; await hook.rerender(undefined);
  mockFocused = true; await hook.rerender(undefined);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => { finish(page); });
  expect(hook.result.current.items).toEqual([]);
  expect(getModerationBottles).toHaveBeenCalledTimes(2);
});
it('重复操作只提交一次，离开页面后不再刷新或写回操作结果', async () => {
  jest.mocked(getModerationBottles).mockResolvedValue(page);
  const revoke = jest.fn();
  const hook = await renderHook(() => useMessageBottleModeration(revoke));
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  let complete!: () => void;
  const operation = jest.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  let first!: Promise<boolean>;
  await act(async () => { first = hook.result.current.run(operation, '保存成功'); });
  await act(async () => { expect(await hook.result.current.run(operation, '保存成功')).toBe(false); });
  mockFocused = false; await hook.rerender(undefined);
  await act(async () => { complete(); expect(await first).toBe(false); });
  expect(operation).toHaveBeenCalledTimes(1);
  expect(getModerationBottles).toHaveBeenCalledTimes(1);
  expect(hook.result.current.items).toEqual([]);
});

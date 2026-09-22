import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useStudyTimer } from './useStudyTimer';
import { recordStudyInterval } from './studyStorage';

let mockFocused = true;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    jest.requireActual('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('./studyStorage', () => ({
  studyStorageKey: jest.fn(async () => 'reader'),
  recordStudyInterval: jest.fn(async () => undefined),
}));

let change: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 22, 12));
  jest.clearAllMocks();
  mockFocused = true;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
const total = () => jest.mocked(recordStudyInterval).mock.calls.reduce((sum, [, start, end]) => sum + end - start, 0);

it('只记录前台聚焦时间，后台与被其他页面覆盖时暂停，返回后继续', async () => {
  const view = await renderHook(() => useStudyTimer(true));
  await act(() => jest.advanceTimersByTime(12_000));
  await act(() => change('background'));
  await act(() => jest.advanceTimersByTime(60_000));
  await act(() => change('active'));
  await act(() => jest.advanceTimersByTime(3_000));
  mockFocused = false;
  await view.rerender({});
  await act(() => jest.advanceTimersByTime(20_000));
  expect(total()).toBe(15_000);
  mockFocused = true;
  await view.rerender({});
  await act(() => jest.advanceTimersByTime(2_000));
  await view.unmount();
  expect(total()).toBe(17_000);
});

it('加载完成之前不计时', async () => {
  const view = await renderHook<void, { enabled: boolean }>(({ enabled }) => useStudyTimer(enabled), { initialProps: { enabled: false } });
  await act(() => jest.advanceTimersByTime(10_000));
  expect(total()).toBe(0);
  await view.rerender({ enabled: true });
  await act(() => jest.advanceTimersByTime(1_500));
  await view.unmount();
  expect(total()).toBe(1_500);
});

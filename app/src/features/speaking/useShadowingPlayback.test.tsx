import { act, renderHook } from '@testing-library/react-native';
import { useShadowingPlayback } from './useShadowingPlayback';
import { initialShadowingState } from './playback';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]) }));
const cues = [{ id: 'one', start: 0, end: 2, en: 'Hello.', zh: '' }, { id: 'two', start: 3, end: 5, en: 'World.', zh: '' }];
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('uses actual seek calls and cancels pending repeat when paused', async () => {
  const control = { play: jest.fn(), pause: jest.fn(), seek: jest.fn().mockResolvedValue(undefined), setRate: jest.fn() };
  const { result } = await renderHook(() => useShadowingPlayback(cues));
  await act(async () => { result.current.onController(control); result.current.onState({ ...initialShadowingState, loaded: true, duration: 6 }); });
  await act(async () => result.current.startLoop({ kind: 'sentence', start: 0, end: 2 }));
  expect(control.seek).toHaveBeenCalledWith(0);
  await act(async () => result.current.onState({ ...initialShadowingState, loaded: true, duration: 6, currentTime: 2, playing: true }));
  expect(result.current.waiting).toBe(true);
  await act(async () => result.current.pause());
  control.play.mockClear();
  await act(async () => jest.advanceTimersByTime(2000));
  expect(control.play).not.toHaveBeenCalled();
});
it('clamps seek, exits AB on an outside seek, and reports failed seeks', async () => {
  const control = { play: jest.fn(), pause: jest.fn(), seek: jest.fn().mockResolvedValue(undefined), setRate: jest.fn() };
  const { result } = await renderHook(() => useShadowingPlayback(cues));
  await act(async () => { result.current.onController(control); result.current.onState({ ...initialShadowingState, loaded: true, duration: 6 }); });
  await act(async () => result.current.startLoop({ kind: 'ab', start: 1, end: 3 }));
  await act(async () => result.current.seek(20));
  expect(control.seek).toHaveBeenLastCalledWith(6);
  expect(result.current.loop).toBeNull();
  control.seek.mockRejectedValueOnce(new Error('failure'));
  await act(async () => result.current.seek(2));
  expect(result.current.error).toContain('定位失败');
});
it('stops after the selected number of actual completed cycles', async () => {
  const control = { play: jest.fn(), pause: jest.fn(), seek: jest.fn().mockResolvedValue(undefined), setRate: jest.fn() };
  const { result } = await renderHook(() => useShadowingPlayback(cues));
  await act(async () => { result.current.onController(control); result.current.setRepeatCount(3); result.current.setGap(1); });
  await act(async () => result.current.startLoop({ kind: 'sentence', start: 0, end: 2 }));
  for (let cycle = 1; cycle <= 3; cycle++) {
    await act(async () => result.current.onState({ ...initialShadowingState, loaded: true, duration: 6, currentTime: .1, playing: true }));
    await act(async () => result.current.onState({ ...initialShadowingState, loaded: true, duration: 6, currentTime: 2, playing: true }));
    if (cycle < 3) {
      expect(result.current.waiting).toBe(true);
      await act(async () => jest.advanceTimersByTime(1000));
    }
  }
  expect(result.current.loop).toBeNull();
  expect(control.play).toHaveBeenCalledTimes(3);
  expect(control.seek).toHaveBeenCalledTimes(3);
});
it('never starts a pending restart after a manual pause', async () => {
  let resolveSeek!: () => void;
  const control = { play: jest.fn(), pause: jest.fn(), seek: jest.fn(() => new Promise<void>(resolve => { resolveSeek = resolve; })), setRate: jest.fn() };
  const { result } = await renderHook(() => useShadowingPlayback(cues));
  await act(async () => { result.current.onController(control); result.current.onState({ ...initialShadowingState, loaded: true, duration: 6, currentTime: 6, finished: true }); });
  let restarting!: Promise<void>;
  await act(async () => { restarting = result.current.toggle(); });
  await act(async () => result.current.pause());
  await act(async () => { resolveSeek(); await restarting; });
  expect(control.play).not.toHaveBeenCalled();
});
it('restores the selected playback rate after a private media URL refresh replaces the player', async () => {
  const first = { play: jest.fn(), pause: jest.fn(), seek: jest.fn().mockResolvedValue(undefined), setRate: jest.fn() };
  const next = { ...first, setRate: jest.fn() };
  const { result } = await renderHook(() => useShadowingPlayback(cues));
  await act(async () => { result.current.onController(first); result.current.changeRate(.75); });
  await act(async () => { result.current.onController(null); result.current.onController(next); });
  expect(next.setRate).toHaveBeenCalledWith(.75);
  expect(result.current.rate).toBe(.75);
});

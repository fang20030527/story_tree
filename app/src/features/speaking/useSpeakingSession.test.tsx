import { act, renderHook } from '@testing-library/react-native';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import { updateSpeakingStore } from './speakingStorage';
import { useSpeakingSession } from './useSpeakingSession';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]) }));
jest.mock('./speakingStorage', () => ({ updateSpeakingStore: jest.fn() }));
const material: SpeakingMaterial = { id: 'a', title: 'A', subtitle: '', category: '生活', origin: 'platform', mediaType: 'audio', duration: 5, cues: [{ id: 'cue-a', start: 0, end: 2, en: 'Hello', zh: '' }, { id: 'cue-b', start: 3, end: 5, en: 'World', zh: '' }] };
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-30T12:00:00Z')); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());
it('counts active practice time, keeps one session on repeated saves and stores the real position', async () => {
  const store = emptySpeakingStore();
  jest.mocked(updateSpeakingStore).mockImplementation(async update => { update(store); return store; });
  const view = await renderHook(({ enabled, position, cueIndex }: { enabled: boolean; position: number; cueIndex: number }) => useSpeakingSession(material, 'user-a', enabled, position, cueIndex), { initialProps: { enabled: true, position: 0, cueIndex: 0 } });
  await act(async () => jest.advanceTimersByTime(1500));
  await view.rerender({ enabled: true, position: 3.5, cueIndex: 1 });
  await act(async () => jest.advanceTimersByTime(500));
  await view.rerender({ enabled: false, position: 3.5, cueIndex: 1 });
  await act(async () => jest.advanceTimersByTime(10000));
  await act(async () => { await view.result.current.save(); await view.result.current.save(); });
  expect(store.history).toHaveLength(1);
  expect(store.history[0]).toEqual(expect.objectContaining({ elapsedMs: 2000, cueCount: 2 }));
  expect(store.positions.a).toBe(3.5);
  expect(updateSpeakingStore).toHaveBeenLastCalledWith(expect.any(Function), 'user-a');
});
it('creates no practice record just by opening a page', async () => {
  const { result } = await renderHook(() => useSpeakingSession(material, 'user-a', false, 0, 0));
  await act(async () => jest.advanceTimersByTime(10000));
  await act(async () => expect(await result.current.save()).toBeNull());
  expect(updateSpeakingStore).not.toHaveBeenCalled();
});

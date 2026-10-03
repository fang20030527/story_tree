import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { registerAnonymous } from '@/api/practices';
import { requestSentenceTranslation } from '@/api/sentences';
import type { SpeakingMaterial } from './model';
import { useShadowingTranslations } from './useShadowingTranslations';

jest.mock('@/api/sentences', () => ({ requestSentenceTranslation: jest.fn() }));
jest.mock('@/api/practices', () => ({ registerAnonymous: jest.fn() }));
const material: SpeakingMaterial = {
  id: 'film', title: '电影', subtitle: '', category: '电影', origin: 'file', mediaType: 'video', duration: 7200,
  cues: [{ id: 'one', start: 0, end: 3, en: 'Bring him home.', zh: '' }],
};
const scope = 'speaking:v1:guest';
const advance = (ms: number) => act(async () => { jest.advanceTimersByTime(ms); });
beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks(); await AsyncStorage.clear();
  jest.mocked(registerAnonymous).mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111', kind: 'guest', remainingFreePractices: 3 });
});
afterEach(() => { jest.useRealTimers(); });

it('reads bundled platform Chinese directly and never translates platform cues or reuses API caches', async () => {
  await AsyncStorage.setItem(`context_reader_speaking_translation_v1:${scope}:${material.id}`, JSON.stringify({ one: { sourceText: material.cues[0]!.en, translatedTextZh: '旧的现场译文。' } }));
  const platform: SpeakingMaterial = { ...material, origin: 'platform', cues: [...material.cues, { id: 'two', start: 4, end: 7, en: 'My king.', zh: '我的国王。' }] };
  const view = await renderHook(() => useShadowingTranslations(platform, scope, 0, true));
  await act(async () => { view.result.current.showVisibleIndexes([0, 1]); view.result.current.retry(0, 0); });
  await advance(60_000);
  expect(view.result.current.cues).toBe(platform.cues);
  expect(view.result.current.cues[0]!.zh).toBe('');
  expect(view.result.current.cues[1]!.zh).toBe('我的国王。');
  expect(view.result.current.states).toEqual({});
  expect(requestSentenceTranslation).not.toHaveBeenCalled();
  expect(registerAnonymous).not.toHaveBeenCalled();
  await view.unmount();
});

it('translates only current and visible cues with bounded concurrency, then stops new requests when disabled', async () => {
  const film = { ...material, cues: Array.from({ length: 300 }, (_, index) => ({ id: `cue-${index}`, start: index * 4, end: index * 4 + 3, en: `Sentence ${index}.`, zh: '' })) };
  const finish: ((text: string) => void)[] = [];
  jest.mocked(requestSentenceTranslation).mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
  const view = await renderHook(({ enabled }: { enabled: boolean }) => useShadowingTranslations(film, scope, 200, enabled), { initialProps: { enabled: true } });
  await act(async () => { view.result.current.showVisibleIndexes([210, 211]); });
  await advance(300);
  expect(requestSentenceTranslation).toHaveBeenNthCalledWith(1, 'Sentence 200.');
  await advance(1099);
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(requestSentenceTranslation).toHaveBeenNthCalledWith(2, 'Sentence 201.');
  await advance(10_000);
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(2);
  await act(async () => { finish[0]!('当前句译文。'); });
  await advance(300);
  expect(requestSentenceTranslation).toHaveBeenNthCalledWith(3, 'Sentence 210.');
  await view.rerender({ enabled: false });
  await act(async () => { finish[1]!('下一句译文。'); finish[2]!('可见句译文。'); });
  await advance(60_000);
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(3);
  expect(registerAnonymous).toHaveBeenCalledTimes(1);
  expect(registerAnonymous).toHaveBeenCalledWith(true);
  expect(view.result.current.cues[200]!.zh).toBe('当前句译文。');
  expect(view.result.current.cues[210]!.zh).toBe('可见句译文。');
  expect(view.result.current.cues[211]!.zh).toBe('');
  await view.unmount();
});

it('reuses cached Chinese after reopening, but regenerates it for edited English and isolates account caches', async () => {
  jest.mocked(requestSentenceTranslation).mockResolvedValue('带他回家。');
  const first = await renderHook(() => useShadowingTranslations(material, scope, 0, true));
  await advance(300);
  expect(first.result.current.cues[0]!.zh).toBe('带他回家。');
  await first.unmount();
  const cached = await renderHook(() => useShadowingTranslations(material, scope, 0, true));
  await advance(10_000);
  expect(cached.result.current.cues[0]!.zh).toBe('带他回家。');
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  await cached.unmount();

  const edited = { ...material, cues: [{ ...material.cues[0]!, en: 'My king.' }] };
  jest.mocked(requestSentenceTranslation).mockResolvedValue('我的国王。');
  const changed = await renderHook(() => useShadowingTranslations(edited, scope, 0, true));
  await advance(300);
  expect(changed.result.current.cues[0]!.zh).toBe('我的国王。');
  expect(requestSentenceTranslation).toHaveBeenLastCalledWith('My king.');
  await changed.unmount();
  const account = await renderHook(() => useShadowingTranslations(edited, 'speaking:v1:another-account', 0, true));
  expect(account.result.current.cues[0]!.zh).toBe('');
  await advance(300);
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(3);
  expect(registerAnonymous).toHaveBeenCalledTimes(2);
  await account.unmount();
});

it('preserves existing Chinese without calling the translation service', async () => {
  const bilingual = { ...material, cues: [{ ...material.cues[0]!, zh: '现有译文。' }] };
  const view = await renderHook(() => useShadowingTranslations(bilingual, scope, 0, true));
  await advance(60_000);
  expect(view.result.current.cues[0]!.zh).toBe('现有译文。');
  expect(requestSentenceTranslation).not.toHaveBeenCalled();
  expect(registerAnonymous).not.toHaveBeenCalled();
  await view.unmount();
});

it('waits for anonymous registration before translating and retries a failed registration', async () => {
  jest.mocked(registerAnonymous).mockRejectedValueOnce(new Error('身份服务暂时不可用'));
  jest.mocked(requestSentenceTranslation).mockResolvedValue('带他回家。');
  const view = await renderHook(() => useShadowingTranslations(material, scope, 0, true));
  await advance(300);
  expect(requestSentenceTranslation).not.toHaveBeenCalled();
  expect(view.result.current.states.one?.status).toBe('error');
  await act(async () => { view.result.current.retry(0, 0); });
  await advance(1100);
  expect(registerAnonymous).toHaveBeenCalledTimes(2);
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  expect(view.result.current.cues[0]!.zh).toBe('带他回家。');
  await view.unmount();
});

it('does not display English as Chinese or retry failures in a loop, and supports explicit retry', async () => {
  jest.mocked(requestSentenceTranslation).mockResolvedValueOnce('Bring him home.').mockResolvedValueOnce('带他回家。');
  const view = await renderHook(() => useShadowingTranslations(material, scope, 0, true));
  await advance(300);
  expect(view.result.current.cues[0]!.zh).toBe('');
  expect(view.result.current.states.one?.status).toBe('error');
  await advance(60_000);
  expect(requestSentenceTranslation).toHaveBeenCalledTimes(1);
  await act(async () => { view.result.current.retry(0, 0); });
  await advance(300);
  expect(view.result.current.cues[0]!.zh).toBe('带他回家。');
  expect(view.result.current.states.one).toBeUndefined();
  await view.unmount();
});

it('ignores late results after the material changes', async () => {
  let finish!: (text: string) => void;
  jest.mocked(requestSentenceTranslation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = await renderHook(({ id }: { id: string }) => useShadowingTranslations({ ...material, id }, scope, 0, true), { initialProps: { id: 'first-film' } });
  await advance(300);
  await view.rerender({ id: 'second-film' });
  await act(async () => { finish('第一部影片的译文。'); });
  expect(view.result.current.cues[0]!.zh).toBe('');
  expect(view.result.current.states.one).toBeUndefined();
  await view.unmount();
});

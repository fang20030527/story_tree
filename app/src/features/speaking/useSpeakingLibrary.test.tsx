import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SpeakingLibraryDto, SpeakingMaterialDto, SpeakingStateDto } from '@context-reader/contracts';
import { getSpeakingCatalog, getSpeakingCatalogMaterial, getSpeakingLibrary, getSpeakingMaterial, getSpeakingState } from '@/api/speaking';
import { loadAuthUser } from '@/features/auth/authStorage';
import { updateSpeakingStore } from './speakingStorage';
import { useSpeakingLibrary } from './useSpeakingLibrary';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]) }));
jest.mock('@/api/speaking', () => ({ getSpeakingCatalog: jest.fn(), getSpeakingCatalogMaterial: jest.fn(), getSpeakingLibrary: jest.fn(), getSpeakingMaterial: jest.fn(), getSpeakingState: jest.fn() }));
jest.mock('@/features/auth/authStorage', () => ({ loadAuthUser: jest.fn() }));
const userId = '11111111-1111-4111-8111-111111111111';
const filmId = '22222222-2222-4222-8222-222222222222';
const details: SpeakingMaterialDto = {
  id: filmId, title: 'Movie with subtitles', subtitle: '我的跟读文件', category: '个人文件', sourceKind: 'file', mediaType: 'video',
  assetId: userId, videoId: null, duration: 7200, revision: 1, createdAt: '2026-10-01T00:00:00.000Z',
  cues: Array.from({ length: 1600 }, (_, i) => ({ id: `line-${i + 1}`, start: i * 3, end: i * 3 + 2, en: `Line ${i + 1}.`, zh: '' })),
};
const { cues: captionLines, ...metadata } = details;
const state: SpeakingStateDto = { materialId: filmId, revision: 0, savedCueIds: [], notes: {}, position: 0, recording: null };
const page: SpeakingLibraryDto = { materials: [{ ...metadata, cueCount: captionLines.length }], states: [state], sessions: [], nextCursor: filmId };
const shared: SpeakingMaterialDto = { ...details, id: 'forrest-gump-1994', title: '阿甘正传', sourceKind: 'platform', assetId: null, category: '电影对白' };
const { cues: sharedLines, ...sharedMetadata } = shared;
const sharedSummary = { ...sharedMetadata, sourceKind: 'platform' as const, assetId: null, videoId: null, cueCount: sharedLines.length };
const catalogSummaries = [sharedSummary, { ...sharedSummary, id: 'titanic-1997', title: '泰坦尼克号' }, { ...sharedSummary, id: 'the-odyssey-local', title: 'The Odyssey' }];
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  jest.mocked(loadAuthUser).mockResolvedValue({ userId, kind: 'registered', remainingFreePractices: 3 });
  jest.mocked(getSpeakingLibrary).mockResolvedValue(page);
  jest.mocked(getSpeakingMaterial).mockResolvedValue(details);
  jest.mocked(getSpeakingState).mockResolvedValue(state);
  jest.mocked(getSpeakingCatalog).mockResolvedValue({ materials: catalogSummaries });
  jest.mocked(getSpeakingCatalogMaterial).mockResolvedValue(shared);
});
it('uses summaries for the file list and merges another page without fetching full movie captions', async () => {
  await updateSpeakingStore(store => { store.files.push({ id: 'local-old', title: 'Old local movie', subtitle: '', category: '', origin: 'file', mediaType: 'video', duration: 0, cues: [] }); });
  const view = await renderHook(() => useSpeakingLibrary());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(getSpeakingMaterial).not.toHaveBeenCalled();
  expect(view.result.current.materials.find(item => item.id === filmId)).toMatchObject({ cueCount: 1600, cues: [], summary: true });
  const secondId = '33333333-3333-4333-8333-333333333333';
  jest.mocked(getSpeakingLibrary).mockResolvedValueOnce({ ...page, materials: [{ ...metadata, id: secondId, title: 'Second movie', cueCount: 1200 }], states: [], nextCursor: null });
  await act(async () => view.result.current.loadMore());
  expect(getSpeakingLibrary).toHaveBeenLastCalledWith({ limit: 20, cursor: filmId });
  expect(view.result.current.materials.map(item => item.id)).toEqual(expect.arrayContaining([filmId, secondId, 'local-old']));
  expect(view.result.current.store.files.map(item => item.id)).toEqual(['local-old', filmId, secondId]);
  expect(view.result.current.hasMore).toBe(false);
});
it('waits for full captions when opening a movie outside the first page instead of editing an empty summary', async () => {
  jest.mocked(getSpeakingLibrary).mockResolvedValueOnce({ ...page, materials: [], states: [], nextCursor: null });
  let resolveDetails!: (value: SpeakingMaterialDto) => void;
  jest.mocked(getSpeakingMaterial).mockImplementationOnce(() => new Promise(resolve => { resolveDetails = resolve; }));
  const view = await renderHook(() => useSpeakingLibrary(filmId));
  await waitFor(() => expect(getSpeakingMaterial).toHaveBeenCalledWith(filmId));
  expect(view.result.current.loading).toBe(true);
  await act(async () => resolveDetails(details));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.materials.find(item => item.id === filmId)).toMatchObject({ cueCount: 1600, summary: false });
  expect(view.result.current.materials.find(item => item.id === filmId)?.cues).toHaveLength(1600);
});
it('keeps guest practice local and displays a cloud failure without fabricating synchronization', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  const guest = await renderHook(() => useSpeakingLibrary());
  await waitFor(() => expect(guest.result.current.loading).toBe(false));
  expect(guest.result.current.cloud).toBe(false);
  expect(getSpeakingLibrary).not.toHaveBeenCalled();
  expect(getSpeakingCatalog).toHaveBeenCalledTimes(1);
  expect(guest.result.current.materials.find(item => item.id === shared.id)).toMatchObject({ origin: 'platform', cues: [], cueCount: 1600 });
  expect(guest.result.current.store.files).toEqual([]);
  expect(guest.result.current.materials.filter(item => item.category === '电影对白').map(item => item.id)).toEqual(catalogSummaries.map(item => item.id));
  await guest.unmount();
  jest.mocked(loadAuthUser).mockResolvedValue({ userId, kind: 'registered', remainingFreePractices: 3 });
  await updateSpeakingStore(store => { store.positions.curiosity = 12; });
  jest.mocked(getSpeakingLibrary).mockRejectedValueOnce(new Error('network unavailable'));
  const cloud = await renderHook(() => useSpeakingLibrary());
  await waitFor(() => expect(cloud.result.current.loading).toBe(false));
  expect(cloud.result.current.error).toContain('network unavailable');
  expect(cloud.result.current.store.positions.curiosity).toBe(12);
});
it('opens shared films for guests with full public captions and keeps practice state on the device', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  const corrected = [{ ...shared.cues[0]!, en: 'My device caption correction.' }, ...shared.cues.slice(1)];
  await updateSpeakingStore(store => {
    store.positions[shared.id] = 42; store.saved[shared.id] = ['line-1']; store.localSubtitleOverrides[shared.id] = corrected;
  });
  const guest = await renderHook(() => useSpeakingLibrary(shared.id));
  await waitFor(() => expect(guest.result.current.loading).toBe(false));
  const film = guest.result.current.materials.find(item => item.id === shared.id);
  expect(film).toMatchObject({ origin: 'platform', mediaType: 'video', cues: corrected, summary: false });
  expect(film?.storage).toBeUndefined();
  expect(guest.result.current.store.positions[shared.id]).toBe(42);
  expect(guest.result.current.store.saved[shared.id]).toEqual(['line-1']);
  expect(guest.result.current.store.files).toEqual([]);
  expect(getSpeakingCatalogMaterial).toHaveBeenCalledWith(shared.id);
  expect(getSpeakingMaterial).not.toHaveBeenCalled();
  expect(getSpeakingState).not.toHaveBeenCalled();
});
it('merges platform ids once and opens the account subtitle override rather than public original captions', async () => {
  const corrected = [{ ...shared.cues[0]!, en: 'My personal correction.' }, ...shared.cues.slice(1)];
  const accountFilm = { ...shared, revision: 2, cues: corrected };
  jest.mocked(getSpeakingLibrary).mockResolvedValueOnce({ ...page, materials: [sharedSummary, ...page.materials], states: [{ ...state, materialId: shared.id, revision: 4 }], nextCursor: null });
  jest.mocked(getSpeakingMaterial).mockResolvedValueOnce(accountFilm);
  jest.mocked(getSpeakingState).mockResolvedValueOnce({ ...state, materialId: shared.id, revision: 4, position: 50 });
  const account = await renderHook(() => useSpeakingLibrary(shared.id));
  await waitFor(() => expect(account.result.current.loading).toBe(false));
  expect(account.result.current.materials.filter(item => item.id === shared.id)).toHaveLength(1);
  expect(account.result.current.materials.find(item => item.id === shared.id)).toMatchObject({ origin: 'platform', storage: 'cloud', revision: 2, cues: corrected });
  expect(account.result.current.store.files.map(item => item.id)).toEqual([filmId]);
  expect(account.result.current.store.positions[shared.id]).toBe(50);
  expect(getSpeakingCatalogMaterial).not.toHaveBeenCalled();
});
it('keeps the packaged demo available when the public catalog is offline', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  jest.mocked(getSpeakingCatalog).mockRejectedValueOnce(new Error('catalog offline'));
  const demo = await renderHook(() => useSpeakingLibrary('curiosity'));
  await waitFor(() => expect(demo.result.current.loading).toBe(false));
  expect(demo.result.current.error).toBe('');
  expect(demo.result.current.catalogError).toContain('读取失败');
  expect(demo.result.current.materials.find(item => item.id === 'curiosity')?.cues.length).toBeGreaterThan(0);
  expect(getSpeakingCatalogMaterial).not.toHaveBeenCalled();
});

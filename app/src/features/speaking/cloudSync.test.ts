import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadAuthUser } from '@/features/auth/authStorage';
import { createIdempotencyKey } from '@/api/installation';
import { ApiError } from '@/api/client';
import { createSpeakingAsset, getSpeakingState, updateSpeakingState, updateSpeakingSubtitles, uploadSpeakingAssetContent } from '@/api/speaking';
import { resolveSpeakingMedia, speakingMediaInfo } from './mediaStorage';
import type { SpeakingLibraryDto, SpeakingMaterialDto, SpeakingStateDto } from '@context-reader/contracts';
import { emptySpeakingStore, type SpeakingMaterial } from './model';
import { loadSpeakingStore, updateSpeakingStore } from './speakingStorage';
import { cacheSpeakingMaterial, cacheSpeakingPublicDetails, mergeSpeakingCloudLibrary, saveSpeakingCloudRecording, saveSpeakingMaterialState, saveSpeakingMaterialSubtitles } from './cloudSync';

jest.mock('@/features/auth/authStorage', () => ({ loadAuthUser: jest.fn() }));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn() }));
jest.mock('@/api/speaking', () => ({ createSpeakingAsset: jest.fn(), uploadSpeakingAssetContent: jest.fn(), updateSpeakingState: jest.fn(), getSpeakingState: jest.fn(), updateSpeakingSubtitles: jest.fn() }));
jest.mock('./mediaStorage', () => ({ resolveSpeakingMedia: jest.fn(), speakingMediaInfo: jest.fn() }));
const scope = 'speaking:v1:11111111-1111-4111-8111-111111111111';
const cue = { id: 'cue-1', start: 0, end: 2, en: 'Hello.', zh: '' };
const material: SpeakingMaterial = { id: 'curiosity', title: 'A little curiosity', subtitle: '', category: '日常表达', origin: 'platform', mediaType: 'audio', duration: 3, cues: [cue], storage: 'cloud', revision: 1 };
const state: SpeakingStateDto = { materialId: 'curiosity', revision: 0, savedCueIds: [], notes: {}, position: 0, recording: null };
const cloud: SpeakingLibraryDto = {
  materials: [{ id: 'curiosity', title: material.title, subtitle: '', category: '日常表达', sourceKind: 'platform', mediaType: 'audio', assetId: null, videoId: null, duration: 3, cueCount: 1, revision: 1, createdAt: '2026-10-01T00:00:00.000Z' }],
  states: [state], sessions: [], nextCursor: null,
};
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  jest.mocked(loadAuthUser).mockResolvedValue({ userId: scope.split(':').at(-1)!, kind: 'registered', remainingFreePractices: 3 });
  let key = 0; jest.mocked(createIdempotencyKey).mockImplementation(async () => `operation-${key++}`);
  let serverState = { ...state };
  jest.mocked(updateSpeakingState).mockImplementation(async (_id, body) => { serverState = { ...serverState, ...body, revision: body.revision + 1 }; return serverState; });
  jest.mocked(getSpeakingState).mockImplementation(async () => serverState);
});
it('retains recording creation keys across lost responses and supplies a known WebM recording duration', async () => {
  const assetId = '22222222-2222-4222-8222-222222222222';
  const asset = { id: assetId, status: 'awaiting_upload' as const, uploadPath: `/v1/speaking/assets/${assetId}/content`, byteSize: 1234,
    contentType: 'audio/webm' as const, duration: 0, expiresAt: new Date(Date.now() + 600_000).toISOString() };
  const release = jest.fn();
  jest.mocked(resolveSpeakingMedia).mockResolvedValue({ uri: 'blob:recording', release });
  jest.mocked(speakingMediaInfo).mockResolvedValue({ byteSize: 1234, contentType: 'audio/webm' });
  jest.mocked(createSpeakingAsset).mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(asset);
  jest.mocked(uploadSpeakingAssetContent).mockResolvedValue({ ...asset, status: 'ready', duration: 1.5 });
  const recording = { mediaId: 'recording-lost-create', durationMs: 1500, cueId: cue.id, cloudPending: true };
  await expect(saveSpeakingCloudRecording(material, scope, recording)).rejects.toThrow('response lost');
  const store = await saveSpeakingCloudRecording(material, scope, recording);
  expect(jest.mocked(createSpeakingAsset).mock.calls[0]).toEqual(jest.mocked(createSpeakingAsset).mock.calls[1]);
  expect(speakingMediaInfo).toHaveBeenCalledTimes(1);
  expect(uploadSpeakingAssetContent).toHaveBeenCalledWith(asset, expect.objectContaining({ uri: 'blob:recording' }), { durationHintSeconds: 1.5 });
  expect(store.recordings[material.id]).toMatchObject({ assetId, durationMs: 1500 });
  expect(release).toHaveBeenCalledTimes(2);
});
it('renews a canceled recording direct upload with the same creation key and retains the ready asset when a state write fails', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const expired = { id, status: 'awaiting_upload' as const, uploadPath: `/v1/speaking/assets/${id}/content`, byteSize: 1234, contentType: 'audio/webm' as const,
    duration: 0, expiresAt: new Date(Date.now() + 60_000).toISOString(), directUpload: { url: 'https://r2.example.test/private-recording', expiresAt: new Date(Date.now() - 1000).toISOString() } };
  const renewed = { ...expired, directUpload: { ...expired.directUpload, expiresAt: new Date(Date.now() + 600_000).toISOString() } };
  jest.mocked(resolveSpeakingMedia).mockResolvedValue({ uri: 'blob:recording', release: jest.fn() });
  jest.mocked(speakingMediaInfo).mockResolvedValue({ byteSize: 1234, contentType: 'audio/webm' });
  jest.mocked(createSpeakingAsset).mockResolvedValueOnce(expired).mockResolvedValueOnce(renewed);
  jest.mocked(uploadSpeakingAssetContent).mockRejectedValueOnce(new Error('上传已取消')).mockResolvedValueOnce({ ...renewed, status: 'ready', duration: 2 });
  const recording = { mediaId: 'recording-renew', durationMs: 2000, cueId: cue.id, cloudPending: true };
  await expect(saveSpeakingCloudRecording(material, scope, recording)).rejects.toThrow('已取消');
  jest.mocked(updateSpeakingState).mockRejectedValueOnce(new Error('state response lost'));
  await expect(saveSpeakingCloudRecording(material, scope, recording)).rejects.toThrow('state response lost');
  await saveSpeakingCloudRecording(material, scope, recording);
  expect(createSpeakingAsset).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createSpeakingAsset).mock.calls[0]).toEqual(jest.mocked(createSpeakingAsset).mock.calls[1]);
  expect(uploadSpeakingAssetContent).toHaveBeenCalledTimes(2);
});
it('rejects invalid recording duration before creating or reading media', async () => {
  await expect(saveSpeakingCloudRecording(material, scope, { mediaId: 'invalid-recording', durationMs: 600_001, cueId: cue.id })).rejects.toThrow('10 分钟');
  expect(createSpeakingAsset).not.toHaveBeenCalled(); expect(resolveSpeakingMedia).not.toHaveBeenCalled();
});
it('retains legacy local files, captions, annotations and pending practice on repeated cloud loads', () => {
  const store = emptySpeakingStore();
  store.files.push({ ...material, id: 'local-movie', storage: undefined });
  store.cues.curiosity = [{ ...cue, en: 'My correction.' }];
  store.saved.curiosity = ['cue-1']; store.notes.curiosity = { 'cue-1': '注意停顿' }; store.positions.curiosity = 1.5;
  store.history.push({ id: 'local-session', materialId: 'curiosity', title: material.title, date: '2026-10-01T01:00:00.000Z', elapsedMs: 1000, cueCount: 1, cloudPending: true });
  mergeSpeakingCloudLibrary(store, cloud); mergeSpeakingCloudLibrary(store, cloud);
  expect(store.files.map(file => file.id)).toContain('local-movie');
  expect(store.cues.curiosity[0]?.en).toBe('My correction.');
  expect(store.saved.curiosity).toEqual(['cue-1']);
  expect(store.notes.curiosity).toEqual({ 'cue-1': '注意停顿' });
  expect(store.positions.curiosity).toBe(1.5);
  expect(store.history[0]?.cloudPending).toBe(true);
});
it('retries a lost state response using the original revision, body and idempotency key', async () => {
  await updateSpeakingStore(store => { store.cloudStateRevisions.curiosity = 0; store.notes.curiosity = { 'cue-1': '旧笔记' }; }, scope);
  jest.mocked(updateSpeakingState).mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce({ ...state, revision: 1, savedCueIds: ['cue-1'], notes: { 'cue-1': '旧笔记' } });
  jest.mocked(getSpeakingState).mockResolvedValue({ ...state, revision: 1, savedCueIds: ['cue-1'], notes: { 'cue-1': '旧笔记' } });
  await expect(saveSpeakingMaterialState(material, scope, { savedCueIds: ['cue-1'] })).rejects.toThrow('response lost');
  expect((await loadSpeakingStore(scope)).saved.curiosity).toBeUndefined();
  // Another device/load may have advanced the cached revision after the missing response.
  await updateSpeakingStore(store => { store.cloudStateRevisions.curiosity = 1; }, scope);
  await saveSpeakingMaterialState(material, scope, { savedCueIds: ['cue-1'] });
  expect(updateSpeakingState).toHaveBeenNthCalledWith(2, 'curiosity', expect.objectContaining({ revision: 0, notes: { 'cue-1': '旧笔记' } }), 'operation-0');
  expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  expect((await loadSpeakingStore(scope)).saved.curiosity).toEqual(['cue-1']);
});
it('releases a rejected revision so the same edit succeeds after reading the latest state', async () => {
  let latest: SpeakingStateDto = { ...state, revision: 3, notes: { 'cue-1': '另一台设备的笔记' } };
  jest.mocked(updateSpeakingState)
    .mockRejectedValueOnce(new ApiError('STATE_CONFLICT', '内容已更新，请重新读取后保存', true))
    .mockImplementation(async (_id, body) => {
      if (body.revision !== latest.revision) throw new ApiError('STATE_CONFLICT', '内容已更新，请重新读取后保存', true);
      latest = { ...latest, ...body, revision: body.revision + 1 };
      return latest;
    });
  jest.mocked(getSpeakingState).mockImplementation(async () => latest);
  const patch = { savedCueIds: ['cue-1'] };
  await expect(saveSpeakingMaterialState(material, scope, patch)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  const refreshed = await getSpeakingState(material.id);
  await updateSpeakingStore(store => { mergeSpeakingCloudLibrary(store, { ...cloud, states: [refreshed] }); }, scope);
  const saved = await saveSpeakingMaterialState(material, scope, patch);
  expect(updateSpeakingState).toHaveBeenNthCalledWith(1, material.id, expect.objectContaining({ revision: 0 }), 'operation-0');
  expect(updateSpeakingState).toHaveBeenNthCalledWith(2, material.id, expect.objectContaining({ revision: 3, ...patch, notes: refreshed.notes }), 'operation-1');
  expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
  expect(saved.saved.curiosity).toEqual(['cue-1']);
  expect(saved.notes.curiosity).toEqual(refreshed.notes);
  expect(saved.cloudStateRevisions.curiosity).toBe(4);
});
it('serializes concurrent favorites and refuses to write after the account changes', async () => {
  await Promise.all(['cue-1', 'cue-2'].map(id => saveSpeakingMaterialState(material, scope, store => ({ savedCueIds: [...(store.saved.curiosity ?? []), id] }))));
  expect((await loadSpeakingStore(scope)).saved.curiosity).toEqual(['cue-1', 'cue-2']);
  expect(updateSpeakingState).toHaveBeenNthCalledWith(2, 'curiosity', expect.objectContaining({ revision: 1, savedCueIds: ['cue-1', 'cue-2'] }), 'operation-1');
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  await expect(saveSpeakingMaterialState(material, scope, { position: 2 })).rejects.toThrow('登录状态');
  expect(updateSpeakingState).toHaveBeenCalledTimes(2);
});
it('keeps full cached captions when refreshing summaries and keeps the subtitle retry key until state refresh succeeds', async () => {
  const original: SpeakingMaterialDto = { ...cloud.materials[0]!, cues: [cue] };
  await updateSpeakingStore(store => { cacheSpeakingMaterial(store, original); }, scope);
  const cached = await updateSpeakingStore(store => { mergeSpeakingCloudLibrary(store, cloud); }, scope);
  expect(cached.cues.curiosity).toEqual([cue]);
  expect(cached.cloudMaterials[0]?.summary).toBe(false);
  const revised = [{ ...cue, en: 'Revised caption.' }];
  jest.mocked(updateSpeakingSubtitles).mockResolvedValue({ ...original, cues: revised, revision: 2 });
  jest.mocked(getSpeakingState).mockRejectedValueOnce(new Error('state response lost')).mockResolvedValueOnce({ ...state, revision: 1 });
  await expect(saveSpeakingMaterialSubtitles(material, scope, revised)).rejects.toThrow('state response lost');
  await updateSpeakingStore(store => { store.cloudMaterials[0]!.revision = 2; }, scope);
  await saveSpeakingMaterialSubtitles(material, scope, revised);
  expect(updateSpeakingSubtitles).toHaveBeenNthCalledWith(2, 'curiosity', { revision: 1, cues: revised }, 'operation-0');
  expect((await loadSpeakingStore(scope)).cues.curiosity).toEqual(revised);
});
it('migrates legacy favorites and notes before subtitle correction advances the state revision', async () => {
  await updateSpeakingStore(store => { store.saved.curiosity = ['cue-1']; store.notes.curiosity = { 'cue-1': '旧笔记' }; }, scope);
  const revised = [{ ...cue, en: 'Revised caption.' }];
  jest.mocked(updateSpeakingSubtitles).mockResolvedValue({ ...cloud.materials[0]!, cues: revised, revision: 2 });
  jest.mocked(getSpeakingState).mockResolvedValue({ ...state, revision: 2, savedCueIds: ['cue-1'], notes: { 'cue-1': '旧笔记' } });
  const result = await saveSpeakingMaterialSubtitles(material, scope, revised);
  expect(updateSpeakingState).toHaveBeenCalledWith('curiosity', { revision: 0, savedCueIds: ['cue-1'], notes: { 'cue-1': '旧笔记' } }, 'operation-0');
  expect(result.notes.curiosity).toEqual({ 'cue-1': '旧笔记' });
  expect(result.cloudStateRevisions.curiosity).toBe(2);
});
it('keeps only the current shared film captions cached without losing guest corrections or local files', async () => {
  jest.mocked(loadAuthUser).mockResolvedValue(null);
  const guestScope = 'speaking:v1:guest';
  const first: SpeakingMaterialDto = { ...cloud.materials[0]!, id: 'forrest-gump-1994', title: '阿甘正传', mediaType: 'video', category: '电影对白', cues: [cue] };
  const second = { ...first, id: 'titanic-1997', title: '泰坦尼克号' };
  let store = await updateSpeakingStore(current => {
    current.files.push({ ...material, id: 'local-movie', origin: 'file', storage: undefined });
    current.cues['local-movie'] = [cue];
    cacheSpeakingPublicDetails(current, first);
  }, guestScope);
  const guestFilm = store.cloudMaterials.find(item => item.id === first.id)!;
  expect(guestFilm.storage).toBeUndefined();
  await saveSpeakingMaterialState(guestFilm, guestScope, { savedCueIds: ['cue-1'], notes: { 'cue-1': '本机笔记' }, position: 1 });
  const corrected = [{ ...cue, en: 'A correction kept on this device.' }];
  await saveSpeakingMaterialSubtitles(guestFilm, guestScope, corrected);
  store = await updateSpeakingStore(current => { cacheSpeakingPublicDetails(current, second); }, guestScope);
  expect(store.cues[first.id]).toBeUndefined();
  expect(store.cues[second.id]).toEqual([cue]);
  expect(store.cues['local-movie']).toEqual([cue]);
  expect(store.localSubtitleOverrides[first.id]).toEqual(corrected);
  expect(store.saved[first.id]).toEqual(['cue-1']);
  expect(store.notes[first.id]).toEqual({ 'cue-1': '本机笔记' });
  expect(store.positions[first.id]).toBe(1);
  expect(store.files.map(item => item.id)).toEqual(['local-movie']);
  store = await updateSpeakingStore(current => { cacheSpeakingPublicDetails(current, first); }, guestScope);
  expect(store.cues[second.id]).toBeUndefined();
  expect(store.cloudMaterials.find(item => item.id === second.id)?.summary).toBe(true);
  expect(store.localSubtitleOverrides[first.id]).toEqual(corrected);
  expect(updateSpeakingState).not.toHaveBeenCalled();
  expect(updateSpeakingSubtitles).not.toHaveBeenCalled();
});

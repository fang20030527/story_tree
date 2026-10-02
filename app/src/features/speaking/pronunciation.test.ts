import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreateSpeakingPronunciationRequest, SpeakingPronunciationAssessmentDto, SpeakingPronunciationCapability } from '@context-reader/contracts';
import { ApiError } from '@/api/client';
import { createIdempotencyKey } from '@/api/installation';
import { createSpeakingAsset, createSpeakingPronunciationAssessment, getSpeakingPronunciationAssessment, uploadSpeakingAssetContent } from '@/api/speaking';
import { loadAuthUser } from '@/features/auth/authStorage';
import { resolveSpeakingMedia, speakingMediaInfo } from './mediaStorage';
import { emptySpeakingStore, SpeakingStoreSchema, type SpeakingMaterial, type SpeakingRecording } from './model';
import { speakingPronunciationKey, restoreSpeakingPronunciation, submitSpeakingPronunciation } from './pronunciation';
import { loadSpeakingStore, updateSpeakingStore } from './speakingStorage';

jest.mock('@/features/auth/authStorage', () => ({ loadAuthUser: jest.fn() }));
jest.mock('@/api/installation', () => ({ createIdempotencyKey: jest.fn() }));
jest.mock('@/api/speaking', () => ({ createSpeakingAsset: jest.fn(), uploadSpeakingAssetContent: jest.fn(), createSpeakingPronunciationAssessment: jest.fn(), getSpeakingPronunciationAssessment: jest.fn() }));
jest.mock('./mediaStorage', () => ({ resolveSpeakingMedia: jest.fn(), speakingMediaInfo: jest.fn() }));
const userId = '11111111-1111-4111-8111-111111111111';
const scope = `speaking:v1:${userId}`;
const assetId = '22222222-2222-4222-8222-222222222222';
const assessmentId = '33333333-3333-4333-8333-333333333333';
const material: SpeakingMaterial = { id: 'curiosity', title: 'Practice', subtitle: '', category: '', origin: 'platform', mediaType: 'audio', duration: 3, storage: 'cloud', revision: 2, cues: [{ id: 'cue-1', start: 0, end: 3, en: 'Hello there.', zh: '' }] };
const recording: SpeakingRecording = { mediaId: assetId, assetId, durationMs: 2000, cueId: 'cue-1', referenceText: 'Hello there.', subtitleRevision: 2 };
const capability: SpeakingPronunciationCapability = { available: true, provider: 'speechace', maxDurationMs: 30000, maxAudioBytes: 2 * 1024 * 1024, locales: ['en-us', 'en-gb'] };
const context = { materialId: material.id, material, scope, recording, locale: 'en-us' as const, capability };
const timestamp = '2026-10-02T00:00:00.000Z';
const result = { score: 84.5, words: [{ word: 'Hello', score: 65, startMs: 0, endMs: 800, phonemes: [{ symbol: 'h', spokenSymbol: null, score: 58, stressScore: null, startMs: null, endMs: null }] }, { word: 'there', score: null, startMs: null, endMs: null, phonemes: [] }], feedback: ['先慢读低分单词，再放回整句练习。'] };
function dto(request: CreateSpeakingPronunciationRequest, status: SpeakingPronunciationAssessmentDto['status'] = 'ready'): SpeakingPronunciationAssessmentDto {
  return { ...request, id: assessmentId, provider: 'speechace', status, result: status === 'ready' ? result : null, error: status === 'failed' ? { code: 'SPEECHACE_TIMEOUT', message: '评分超时，请重试', retryable: true } : null, createdAt: timestamp, updatedAt: timestamp };
}
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  jest.mocked(loadAuthUser).mockResolvedValue({ userId, kind: 'registered', remainingFreePractices: 3 });
  let count = 0; jest.mocked(createIdempotencyKey).mockImplementation(async () => `attempt-${count++}`);
  jest.mocked(createSpeakingPronunciationAssessment).mockImplementation(async request => dto(request));
  jest.mocked(resolveSpeakingMedia).mockResolvedValue({ uri: 'blob:local-recording', release: jest.fn() });
  jest.mocked(speakingMediaInfo).mockResolvedValue({ byteSize: 1024, contentType: 'audio/webm' });
  const asset = { id: assetId, status: 'awaiting_upload' as const, uploadPath: `/v1/speaking/assets/${assetId}/content`, byteSize: 1024, contentType: 'audio/webm' as const, duration: 0, expiresAt: timestamp };
  jest.mocked(createSpeakingAsset).mockResolvedValue(asset);
  jest.mocked(uploadSpeakingAssetContent).mockResolvedValue({ ...asset, status: 'ready', duration: 2 });
  await updateSpeakingStore(store => { store.recordings[material.id] = recording; }, scope);
});
it('retains a lost POST payload/key across persistent storage reloads and reuses the successful result', async () => {
  jest.mocked(createSpeakingPronunciationAssessment).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '网络连接失败', true));
  await expect(submitSpeakingPronunciation(context)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  const key = speakingPronunciationKey(material.id, recording, 'en-us');
  expect((await loadSpeakingStore(scope)).pronunciations[key]).toMatchObject({ idempotencyKey: 'attempt-0', request: { assetId, referenceText: 'Hello there.' } });
  await submitSpeakingPronunciation({ ...context, recording: (await loadSpeakingStore(scope)).recordings[material.id]! });
  expect(jest.mocked(createSpeakingPronunciationAssessment).mock.calls[0]).toEqual(jest.mocked(createSpeakingPronunciationAssessment).mock.calls[1]);
  await expect(submitSpeakingPronunciation(context)).resolves.toMatchObject({ status: 'ready', result: { score: 84.5 } });
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledTimes(2);
  expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  expect(createSpeakingAsset).not.toHaveBeenCalled(); expect(resolveSpeakingMedia).not.toHaveBeenCalled();
});
it('creates a new key only after a confirmed failed assessment, retaining the same target/audio', async () => {
  jest.mocked(createSpeakingPronunciationAssessment).mockImplementationOnce(async request => dto(request, 'failed'));
  await expect(submitSpeakingPronunciation(context)).resolves.toMatchObject({ status: 'failed' });
  await expect(submitSpeakingPronunciation(context)).resolves.toMatchObject({ status: 'ready' });
  expect(jest.mocked(createSpeakingPronunciationAssessment).mock.calls.map(call => call[1])).toEqual(['attempt-0', 'attempt-1']);
  expect(jest.mocked(createSpeakingPronunciationAssessment).mock.calls[0]![0]).toEqual(jest.mocked(createSpeakingPronunciationAssessment).mock.calls[1]![0]);
});
it('restores processing assessments with GET and does not create another billable attempt', async () => {
  jest.mocked(createSpeakingPronunciationAssessment).mockImplementationOnce(async request => dto(request, 'processing'));
  const processing = await submitSpeakingPronunciation(context);
  jest.mocked(getSpeakingPronunciationAssessment).mockResolvedValue({ ...processing, status: 'ready', result });
  await expect(restoreSpeakingPronunciation(context)).resolves.toMatchObject({ result: { score: 84.5 } });
  await restoreSpeakingPronunciation(context);
  expect(getSpeakingPronunciationAssessment).toHaveBeenCalledTimes(1);
  expect(getSpeakingPronunciationAssessment).toHaveBeenCalledWith(assessmentId, { signal: undefined });
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledTimes(1);
});
it('keeps different locales and different recordings separate', async () => {
  await submitSpeakingPronunciation(context);
  await submitSpeakingPronunciation({ ...context, locale: 'en-gb' });
  await submitSpeakingPronunciation({ ...context, recording: { ...recording, mediaId: '44444444-4444-4444-8444-444444444444', assetId: '44444444-4444-4444-8444-444444444444' } });
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledTimes(3);
  expect(Object.keys((await loadSpeakingStore(scope)).pronunciations)).toHaveLength(3);
});
it('retains local upload keys after a lost creation response and never switches local playback to the assessment asset', async () => {
  const local: SpeakingRecording = { mediaId: 'local-recording', durationMs: 2000, cueId: 'cue-1', referenceText: 'Hello there.' };
  const localMaterial = { ...material, storage: undefined, origin: 'file' as const };
  await updateSpeakingStore(store => { store.recordings[material.id] = local; }, scope);
  jest.mocked(createSpeakingAsset).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'response lost', true));
  const input = { ...context, material: localMaterial, recording: local };
  await expect(submitSpeakingPronunciation(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  await submitSpeakingPronunciation(input);
  expect(jest.mocked(createSpeakingAsset).mock.calls[0]).toEqual(jest.mocked(createSpeakingAsset).mock.calls[1]);
  expect(uploadSpeakingAssetContent).toHaveBeenCalledWith(expect.objectContaining({ id: assetId }), expect.objectContaining({ uri: 'blob:local-recording', mimeType: 'audio/webm' }), { signal: undefined, durationHintSeconds: 2 });
  const saved = (await loadSpeakingStore(scope)).recordings[material.id]!;
  expect(saved).toMatchObject({ mediaId: 'local-recording', assessmentAssetId: assetId });
  expect(saved.assetId).toBeUndefined();
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledWith(expect.objectContaining({ assetId, materialId: null, subtitleRevision: null }), 'attempt-0', { signal: undefined });
});
it.each(['UPLOAD_SESSION_EXPIRED', 'NOT_FOUND'])('waits for a new user submission after %s, preserving local audio and other locale results', async code => {
  const local: SpeakingRecording = { mediaId: 'local-expiring', durationMs: 2000, cueId: 'cue-1', referenceText: 'Hello there.' };
  const input = { ...context, material: { ...material, storage: undefined }, recording: local };
  await updateSpeakingStore(store => { store.recordings[material.id] = local; }, scope);
  await submitSpeakingPronunciation(input);
  const staleProps = (await loadSpeakingStore(scope)).recordings[material.id]!;
  jest.mocked(createSpeakingPronunciationAssessment).mockRejectedValueOnce(new ApiError(code, '资产已过期', false));
  await expect(submitSpeakingPronunciation({ ...input, recording: staleProps, locale: 'en-gb' })).rejects.toMatchObject({ code: 'SPEAKING_PRONUNCIATION_UPLOAD_EXPIRED', retryable: true });
  const cache = await loadSpeakingStore(scope);
  expect(cache.recordings[material.id]).toMatchObject({ mediaId: 'local-expiring' });
  expect(cache.recordings[material.id]?.assessmentAssetId).toBeUndefined();
  expect(cache.pronunciations[speakingPronunciationKey(material.id, local, 'en-us')]?.assessment?.status).toBe('ready');
  expect(cache.pronunciations[speakingPronunciationKey(material.id, local, 'en-gb')]).toBeUndefined();
  expect(createSpeakingAsset).toHaveBeenCalledTimes(1);
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledTimes(2);
  await submitSpeakingPronunciation({ ...input, recording: staleProps, locale: 'en-gb' });
  expect(createSpeakingAsset).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createSpeakingPronunciationAssessment).mock.calls.map(call => call[1])).toEqual(['attempt-0', 'attempt-2', 'attempt-3']);
});
it.each(['UPLOAD_SESSION_EXPIRED', 'NOT_FOUND'])('clears an expired asset creation replay after %s and starts a new upload only on the next submission', async code => {
  const local: SpeakingRecording = { mediaId: 'expired-create-replay', durationMs: 2000, cueId: 'cue-1', referenceText: 'Hello there.' };
  const input = { ...context, material: { ...material, storage: undefined }, recording: local };
  await updateSpeakingStore(store => { store.recordings[material.id] = local; }, scope);
  jest.mocked(createSpeakingAsset).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '创建响应丢失', true))
    .mockRejectedValueOnce(new ApiError(code, '创建的上传会话已过期', false));
  await expect(submitSpeakingPronunciation(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  const key = speakingPronunciationKey(material.id, local, 'en-us');
  expect((await loadSpeakingStore(scope)).pronunciations[key]).toMatchObject({ idempotencyKey: 'attempt-0', upload: { key: 'attempt-1' } });
  await expect(submitSpeakingPronunciation(input)).rejects.toMatchObject({ code: 'SPEAKING_PRONUNCIATION_UPLOAD_EXPIRED', retryable: true });
  expect(jest.mocked(createSpeakingAsset).mock.calls[0]).toEqual(jest.mocked(createSpeakingAsset).mock.calls[1]);
  const expired = await loadSpeakingStore(scope);
  expect(expired.pronunciations[key]).toBeUndefined();
  expect(expired.recordings[material.id]).toEqual(local);
  expect(createSpeakingAsset).toHaveBeenCalledTimes(2);
  expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
  expect(uploadSpeakingAssetContent).not.toHaveBeenCalled(); expect(createSpeakingPronunciationAssessment).not.toHaveBeenCalled();
  await expect(submitSpeakingPronunciation(input)).resolves.toMatchObject({ status: 'ready' });
  expect(createSpeakingAsset).toHaveBeenCalledTimes(3);
  expect(jest.mocked(createSpeakingAsset).mock.calls.map(call => call[1])).toEqual(['attempt-1', 'attempt-1', 'attempt-3']);
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledWith(expect.objectContaining({ assetId, materialId: null }), 'attempt-2', { signal: undefined });
  expect((await loadSpeakingStore(scope)).recordings[material.id]).toMatchObject({ mediaId: local.mediaId, assessmentAssetId: assetId });
});
it.each(['UPLOAD_SESSION_EXPIRED', 'NOT_FOUND'])('clears an expired binary upload after %s while preserving keys on the preceding network failure', async code => {
  const local: SpeakingRecording = { mediaId: 'expired-binary-upload', durationMs: 2000, cueId: 'cue-1', referenceText: 'Hello there.' };
  const input = { ...context, material: { ...material, storage: undefined }, recording: local };
  await updateSpeakingStore(store => { store.recordings[material.id] = local; }, scope);
  jest.mocked(uploadSpeakingAssetContent).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', '上传响应丢失', true))
    .mockRejectedValueOnce(new ApiError(code, '二进制上传会话已过期', false));
  await expect(submitSpeakingPronunciation(input)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  const key = speakingPronunciationKey(material.id, local, 'en-us');
  expect((await loadSpeakingStore(scope)).pronunciations[key]).toMatchObject({ idempotencyKey: 'attempt-0', upload: { key: 'attempt-1', asset: { id: assetId } } });
  await expect(submitSpeakingPronunciation(input)).rejects.toMatchObject({ code: 'SPEAKING_PRONUNCIATION_UPLOAD_EXPIRED', retryable: true });
  const firstUpload = jest.mocked(uploadSpeakingAssetContent).mock.calls[0]!;
  const replayedUpload = jest.mocked(uploadSpeakingAssetContent).mock.calls[1]!;
  expect(replayedUpload[0]).toEqual(firstUpload[0]);
  expect(replayedUpload[1]).toMatchObject({ uri: firstUpload[1].uri, name: firstUpload[1].name, mimeType: firstUpload[1].mimeType });
  expect(replayedUpload[2]).toEqual(firstUpload[2]);
  const expired = await loadSpeakingStore(scope);
  expect(expired.pronunciations[key]).toBeUndefined();
  expect(expired.recordings[material.id]).toEqual(local);
  expect(createSpeakingAsset).toHaveBeenCalledTimes(1);
  expect(uploadSpeakingAssetContent).toHaveBeenCalledTimes(2);
  expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
  expect(createSpeakingPronunciationAssessment).not.toHaveBeenCalled();
  await expect(submitSpeakingPronunciation(input)).resolves.toMatchObject({ status: 'ready' });
  expect(createSpeakingAsset).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createSpeakingAsset).mock.calls.map(call => call[1])).toEqual(['attempt-1', 'attempt-3']);
  expect(uploadSpeakingAssetContent).toHaveBeenCalledTimes(3);
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledWith(expect.objectContaining({ assetId, materialId: null }), 'attempt-2', { signal: undefined });
  expect((await loadSpeakingStore(scope)).recordings[material.id]).toMatchObject({ mediaId: local.mediaId, assessmentAssetId: assetId });
});
it('does not copy another account cache and rejects a late response after the signed-in account changes', async () => {
  jest.mocked(createSpeakingPronunciationAssessment).mockImplementationOnce(async request => {
    jest.mocked(loadAuthUser).mockResolvedValue({ userId: '55555555-5555-4555-8555-555555555555', kind: 'registered', remainingFreePractices: 3 });
    return dto(request);
  });
  await expect(submitSpeakingPronunciation(context)).rejects.toMatchObject({ code: 'SPEAKING_ACCOUNT_CHANGED' });
  const key = speakingPronunciationKey(material.id, recording, 'en-us');
  expect((await loadSpeakingStore(scope)).pronunciations[key]?.assessment).toBeUndefined();
  await expect(restoreSpeakingPronunciation(context)).rejects.toMatchObject({ code: 'SPEAKING_ACCOUNT_CHANGED' });
  const otherScope = 'speaking:v1:55555555-5555-4555-8555-555555555555';
  await expect(restoreSpeakingPronunciation({ ...context, scope: otherScope })).resolves.toBeNull();
  await submitSpeakingPronunciation({ ...context, scope: otherScope });
  expect((await loadSpeakingStore(otherScope)).pronunciations[key]?.assessment?.status).toBe('ready');
  expect((await loadSpeakingStore(scope)).pronunciations[key]?.assessment).toBeUndefined();
  expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
});
it('coalesces concurrent submissions for one recording and rejects mismatched assessment responses', async () => {
  await Promise.all([submitSpeakingPronunciation(context), submitSpeakingPronunciation(context)]);
  expect(createSpeakingPronunciationAssessment).toHaveBeenCalledTimes(1);
  jest.mocked(createSpeakingPronunciationAssessment).mockImplementationOnce(async request => ({ ...dto(request), cueId: 'another-cue' }));
  await expect(submitSpeakingPronunciation({ ...context, locale: 'en-gb' })).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
});
it.each([
  { label: 'missing snapshot', value: { ...recording, referenceText: undefined }, code: 'SPEAKING_RECORDING_SNAPSHOT_REQUIRED' },
  { label: 'missing cloud revision', value: { ...recording, subtitleRevision: undefined }, code: 'SPEAKING_RECORDING_SNAPSHOT_INVALID' },
  { label: 'long recording', value: { ...recording, durationMs: 30001 }, code: 'SPEAKING_PRONUNCIATION_DURATION_INVALID' },
  { label: 'pending cloud save', value: { ...recording, cloudPending: true }, code: 'SPEAKING_RECORDING_NOT_SYNCED' },
])('rejects $label without an upload or scoring request', async ({ value, code }) => {
  await expect(submitSpeakingPronunciation({ ...context, recording: value })).rejects.toMatchObject({ code });
  expect(resolveSpeakingMedia).not.toHaveBeenCalled(); expect(createSpeakingPronunciationAssessment).not.toHaveBeenCalled();
});
it('rejects oversized local audio and guests before any asset creation', async () => {
  jest.mocked(speakingMediaInfo).mockResolvedValue({ byteSize: 2 * 1024 * 1024 + 1, contentType: 'audio/webm' });
  await expect(submitSpeakingPronunciation({ ...context, recording: { ...recording, mediaId: 'huge-local', assetId: undefined }, material: { ...material, storage: undefined } })).rejects.toMatchObject({ code: 'SPEAKING_PRONUNCIATION_AUDIO_TOO_LARGE' });
  await expect(submitSpeakingPronunciation({ ...context, scope: 'speaking:v1:guest' })).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  expect(createSpeakingAsset).not.toHaveBeenCalled(); expect(createSpeakingPronunciationAssessment).not.toHaveBeenCalled();
});
it('reads older stores without pronunciation fields while preserving legacy recordings without snapshots', () => {
  const legacy = emptySpeakingStore();
  const { pronunciations: _unused, ...oldStore } = legacy;
  oldStore.recordings.curiosity = { mediaId: 'old-recording', durationMs: 1000, cueId: 'cue-1' };
  const parsed = SpeakingStoreSchema.parse(oldStore);
  expect(parsed.pronunciations).toEqual({});
  expect(parsed.recordings.curiosity?.referenceText).toBeUndefined();
});

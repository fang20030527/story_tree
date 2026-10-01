import { Platform } from 'react-native';
import { getInstallationToken } from './installation';
import { readSpeakingMediaDuration } from '@/features/speaking/mediaStorage';
import { createSpeakingAsset, createSpeakingMaterial, getSpeakingCatalog, getSpeakingCatalogMaterial, getSpeakingCatalogPlayback, getSpeakingLibrary, getSpeakingPlayback, updateSpeakingState, uploadSpeakingAssetContent } from './speaking';

const mockFileUpload = jest.fn();
const mockReadWholeFile = jest.fn(() => { throw new Error('must not buffer a movie'); });
const mockFileSize = 2 * 1024 * 1024 * 1024;
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ size: mockFileSize, upload: mockFileUpload, arrayBuffer: mockReadWholeFile, base64: mockReadWholeFile })),
  UploadType: { BINARY_CONTENT: 0 },
}));
jest.mock('./installation', () => ({ getInstallationToken: jest.fn() }));
jest.mock('@/features/speaking/mediaStorage', () => ({ readSpeakingMediaDuration: jest.fn() }));
const fetchMock = jest.fn();
const oldBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const asset = {
  id: '11111111-1111-4111-8111-111111111111', status: 'awaiting_upload' as const,
  uploadPath: '/v1/speaking/assets/11111111-1111-4111-8111-111111111111/content',
  byteSize: mockFileSize, contentType: 'video/mp4' as const, duration: 0, expiresAt: '2026-10-01T13:00:00.000Z',
};
const cues = [{ id: 'line-one', start: 0, end: 3, en: 'Hello there.', zh: '你好。' }, { id: 'line-two', start: 2, end: 4, en: 'Good morning.', zh: '' }];
const material = {
  id: asset.id, title: 'Movie', subtitle: '我的跟读文件', category: '个人文件', sourceKind: 'file' as const,
  assetId: asset.id, videoId: null, mediaType: 'video' as const, duration: 10, cues, revision: 1, createdAt: '2026-10-01T12:00:00.000Z',
};
const reply = (data: unknown) => ({ ok: true, status: 200, json: jest.fn().mockResolvedValue(data) });
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset(); mockFileUpload.mockReset();
  jest.mocked(readSpeakingMediaDuration).mockReset().mockResolvedValue(7200);
  jest.replaceProperty(Platform, 'OS', 'ios');
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
  jest.mocked(getInstallationToken).mockResolvedValue('private-bearer');
  global.fetch = fetchMock as typeof fetch;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { if (oldBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL; else process.env.EXPO_PUBLIC_API_BASE_URL = oldBaseUrl; });
it('creates 2 GB assets and overlapping subtitles through the shared contract with explicit idempotency', async () => {
  fetchMock.mockResolvedValueOnce(reply(asset)).mockResolvedValueOnce(reply(material));
  await createSpeakingAsset({ contentType: 'video/mp4', byteSize: mockFileSize, purpose: 'material' }, 'asset-operation');
  await createSpeakingMaterial({ sourceKind: 'file', title: 'Movie', assetId: asset.id, cues }, 'material-operation');
  const request = fetchMock.mock.calls[0]![1] as RequestInit;
  expect(new Headers(request.headers).get('Idempotency-Key')).toBe('asset-operation');
  expect(JSON.parse(request.body as string)).toMatchObject({ byteSize: mockFileSize });
  expect(fetchMock.mock.calls[1]![0]).toBe('https://api.example.test/v1/speaking/materials');
});
it('uses native binary File.upload without reading the movie into JavaScript memory', async () => {
  mockFileUpload.mockResolvedValue({ status: 200, body: JSON.stringify({ ...asset, status: 'ready', duration: 7200 }) });
  await expect(uploadSpeakingAssetContent(asset, { uri: 'file:///movie.mp4', name: 'movie.mp4', lastModified: 0 })).resolves.toMatchObject({ status: 'ready', duration: 7200 });
  expect(mockReadWholeFile).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockFileUpload).toHaveBeenCalledWith(`https://api.example.test${asset.uploadPath}`, expect.objectContaining({
    httpMethod: 'PUT', uploadType: 0, headers: { Authorization: 'Bearer private-bearer', 'Content-Type': 'video/mp4', 'Content-Length': String(mockFileSize) },
  }));
});
it('sends the browser File directly and rejects an unexpected upload destination before reading credentials', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const file = new Blob(['movie'], { type: 'video/mp4' }) as File;
  const browserAsset = { ...asset, byteSize: file.size };
  fetchMock.mockResolvedValue(reply({ ...browserAsset, status: 'ready' }));
  await uploadSpeakingAssetContent(browserAsset, { name: 'movie.mp4', uri: 'blob:movie', file, lastModified: 0 });
  expect(fetchMock).toHaveBeenCalledWith(`https://api.example.test${asset.uploadPath}`, expect.objectContaining({ body: file, method: 'PUT' }));
  jest.mocked(getInstallationToken).mockClear();
  await expect(uploadSpeakingAssetContent({ ...asset, uploadPath: 'https://other.example/upload' }, { name: 'movie.mp4', uri: 'blob:movie', file, lastModified: 0 })).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
  expect(getInstallationToken).not.toHaveBeenCalled();
});
it('reads the private library and obtains playback tickets without appending bearer tokens to URLs', async () => {
  const { cues: captionLines, ...metadata } = material;
  const summary = { ...metadata, cueCount: captionLines.length };
  fetchMock.mockResolvedValueOnce(reply({ materials: [summary], states: [], sessions: [], nextCursor: null }))
    .mockResolvedValueOnce(reply({ url: 'https://api.example.test/v1/speaking/assets/a/play?ticket=short-lived', expiresAt: asset.expiresAt }));
  await expect(getSpeakingLibrary()).resolves.toMatchObject({ materials: [summary], nextCursor: null });
  await getSpeakingPlayback(asset.id);
  expect(fetchMock.mock.calls[1]![0]).toBe(`https://api.example.test/v1/speaking/assets/${asset.id}/playback`);
  expect(fetchMock.mock.calls.every(call => !String(call[0]).includes('private-bearer'))).toBe(true);
});
it('reads shared film summaries, captions and signed playback without requiring an installation token', async () => {
  const shared = { ...material, id: 'forrest-gump-1994', sourceKind: 'platform', assetId: null, category: '电影对白' };
  const { cues: lines, ...metadata } = shared;
  fetchMock.mockResolvedValueOnce(reply({ materials: [{ ...metadata, cueCount: lines.length }] }))
    .mockResolvedValueOnce(reply(shared))
    .mockResolvedValueOnce(reply({ url: 'https://r2.example.test/private-film?signature=short-lived', expiresAt: asset.expiresAt }));
  jest.mocked(getInstallationToken).mockRejectedValue(new Error('guest has not confirmed or signed in'));
  await expect(getSpeakingCatalog()).resolves.toMatchObject({ materials: [{ id: shared.id }] });
  await expect(getSpeakingCatalogMaterial(shared.id)).resolves.toMatchObject({ cues: lines, assetId: null });
  await expect(getSpeakingCatalogPlayback(shared.id)).resolves.toMatchObject({ url: expect.stringContaining('signature=') });
  expect(getInstallationToken).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
    'https://api.example.test/v1/speaking/catalog',
    'https://api.example.test/v1/speaking/catalog/forrest-gump-1994',
    'https://api.example.test/v1/speaking/catalog/forrest-gump-1994/playback',
  ]);
  for (const [, request] of fetchMock.mock.calls) expect(new Headers((request as RequestInit).headers).has('Authorization')).toBe(false);
});
it('keeps revisions and retry keys on state writes, and does not report an unconfirmed upload as success', async () => {
  const state = { materialId: material.id, revision: 2, savedCueIds: ['line-one'], notes: {}, position: 0, recording: null };
  fetchMock.mockResolvedValue(reply(state));
  await updateSpeakingState(material.id, { revision: 1, savedCueIds: ['line-one'] }, 'stable-retry');
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  expect(init.method).toBe('PATCH');
  expect(new Headers(init.headers).get('Idempotency-Key')).toBe('stable-retry');
  mockFileUpload.mockResolvedValue({ status: 200, body: JSON.stringify(asset) });
  await expect(uploadSpeakingAssetContent(asset, { uri: 'file:///movie.mp4', name: 'movie.mp4', lastModified: 0 })).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
});

let directId = 100;
function directAsset() {
  const id = `11111111-1111-4111-8111-${String(directId++).padStart(12, '0')}`;
  return { ...asset, id, uploadPath: `/v1/speaking/assets/${id}/content`, directUpload: {
    url: `https://r2.example.test/private-${id}?signature=temporary`, expiresAt: new Date(Date.now() + 600_000).toISOString(),
  } };
}
const nativeSelection = { uri: 'file:///movie.mp4', name: 'movie.mp4', lastModified: 0 };
it('uploads browser bytes to R2 with conditional headers and authenticates only the completion request', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const file = new Blob(['movie'], { type: 'video/mp4' }) as File;
  const current = { ...directAsset(), byteSize: file.size };
  fetchMock.mockImplementationOnce(async () => {
    expect(getInstallationToken).not.toHaveBeenCalled();
    return { status: 200 }; // S3 PUT may have an empty body.
  }).mockResolvedValueOnce(reply({ ...current, status: 'ready', duration: 7200 }));
  await expect(uploadSpeakingAssetContent(current, { ...nativeSelection, file })).resolves.toMatchObject({ status: 'ready', duration: 7200 });
  const directRequest = fetchMock.mock.calls[0]![1] as RequestInit;
  expect(directRequest).toMatchObject({ method: 'PUT', body: file, credentials: 'omit' });
  expect(new Headers(directRequest.headers)).toEqual(new Headers({ 'Content-Type': 'video/mp4', 'If-None-Match': '*' }));
  expect(new Headers(directRequest.headers).has('Content-Length')).toBe(false);
  const complete = fetchMock.mock.calls[1]!;
  expect(complete[0]).toBe(`https://api.example.test/v1/speaking/assets/${current.id}/complete`);
  expect(new Headers((complete[1] as RequestInit).headers).get('Authorization')).toBe('Bearer private-bearer');
  expect(JSON.parse((complete[1] as RequestInit).body as string)).toEqual({ duration: 7200 });
  expect(new Headers((complete[1] as RequestInit).headers).get('Idempotency-Key')).toBe(`speaking-complete-${current.id}`);
  expect(getInstallationToken).toHaveBeenCalledTimes(1);
});
it('streams native direct upload without manual length or credentials and confirms an existing conditional object', async () => {
  const current = directAsset();
  mockFileUpload.mockImplementation(async () => { expect(getInstallationToken).not.toHaveBeenCalled(); return { status: 412, body: '<S3Error>AlreadyExists</S3Error>' }; });
  fetchMock.mockResolvedValue(reply({ ...current, status: 'ready', duration: 7200 }));
  await expect(uploadSpeakingAssetContent(current, nativeSelection)).resolves.toMatchObject({ status: 'ready' });
  expect(mockFileUpload).toHaveBeenCalledWith(current.directUpload.url, expect.objectContaining({ headers: { 'Content-Type': 'video/mp4', 'If-None-Match': '*' }, httpMethod: 'PUT', uploadType: 0 }));
  expect(mockReadWholeFile).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('retains the original confirmation key and duration after a lost response without reuploading bytes', async () => {
  const current = directAsset();
  mockFileUpload.mockResolvedValue({ status: 204, body: '' });
  fetchMock.mockRejectedValueOnce(new Error('lost complete response'))
    .mockResolvedValueOnce(reply({ ...current, status: 'ready', duration: 7200 }));
  await expect(uploadSpeakingAssetContent(current, nativeSelection, { completeKey: 'stable-complete' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  jest.mocked(readSpeakingMediaDuration).mockResolvedValue(7300);
  const expired = { ...current, directUpload: { ...current.directUpload, expiresAt: new Date(Date.now() - 1000).toISOString() } };
  await expect(uploadSpeakingAssetContent(expired, nativeSelection)).resolves.toMatchObject({ status: 'ready' });
  expect(mockFileUpload).toHaveBeenCalledTimes(1);
  expect(readSpeakingMediaDuration).toHaveBeenCalledTimes(1);
  for (const [, request] of fetchMock.mock.calls) {
    expect(JSON.parse((request as RequestInit).body as string)).toEqual({ duration: 7200 });
    expect(new Headers((request as RequestInit).headers).get('Idempotency-Key')).toBe('stable-complete');
  }
});
it('does not treat transfer success or an awaiting completion DTO as confirmed success', async () => {
  const current = directAsset();
  mockFileUpload.mockResolvedValue({ status: 200, body: '' });
  fetchMock.mockResolvedValueOnce(reply(current)).mockResolvedValueOnce(reply({ ...current, status: 'ready', duration: 7200 }));
  await expect(uploadSpeakingAssetContent(current, nativeSelection)).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
  await expect(uploadSpeakingAssetContent(current, nativeSelection)).resolves.toMatchObject({ status: 'ready' });
  expect(mockFileUpload).toHaveBeenCalledTimes(1);
});
it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 86_401])('rejects invalid parsed duration %s before uploading or confirming', async duration => {
  jest.mocked(readSpeakingMediaDuration).mockResolvedValue(duration);
  await expect(uploadSpeakingAssetContent(directAsset(), nativeSelection)).rejects.toMatchObject({ code: 'SPEAKING_ASSET_DURATION_INVALID' });
  expect(mockFileUpload).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(getInstallationToken).not.toHaveBeenCalled();
});
it('preserves a canceled transfer for a safe conditional retry and does not send a completion after cancellation', async () => {
  const current = directAsset();
  const controller = new AbortController();
  mockFileUpload.mockImplementationOnce(async () => { controller.abort(); throw new Error('canceled'); })
    .mockResolvedValueOnce({ status: 412, body: '' });
  fetchMock.mockResolvedValue(reply({ ...current, status: 'ready', duration: 7200 }));
  await expect(uploadSpeakingAssetContent(current, nativeSelection, { signal: controller.signal })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '上传已取消，可以重试' });
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(uploadSpeakingAssetContent(current, nativeSelection)).resolves.toMatchObject({ status: 'ready' });
  expect(readSpeakingMediaDuration).toHaveBeenCalledTimes(1);
  expect(mockFileUpload).toHaveBeenCalledTimes(2);
});
it('retries completion after cancellation immediately following a successful transfer', async () => {
  const current = directAsset();
  const controller = new AbortController();
  mockFileUpload.mockResolvedValue({ status: 200, body: '' });
  fetchMock.mockResolvedValue(reply({ ...current, status: 'ready', duration: 7200 }));
  await expect(uploadSpeakingAssetContent(current, nativeSelection, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(fetchMock).not.toHaveBeenCalled();
  await uploadSpeakingAssetContent(current, nativeSelection);
  expect(mockFileUpload).toHaveBeenCalledTimes(1);
});
it('does not complete a failed R2 PUT and rejects a non-HTTPS destination before reading credentials', async () => {
  mockFileUpload.mockResolvedValue({ status: 403, body: '<S3Error>PrivateSignature</S3Error>' });
  await expect(uploadSpeakingAssetContent(directAsset(), nativeSelection)).rejects.toMatchObject({ code: 'SPEAKING_UPLOAD_FAILED' });
  expect(getInstallationToken).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  const invalid = directAsset(); invalid.directUpload.url = 'file:///private';
  await expect(uploadSpeakingAssetContent(invalid, nativeSelection)).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
  expect(getInstallationToken).not.toHaveBeenCalled();
});

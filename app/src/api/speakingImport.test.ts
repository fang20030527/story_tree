import { fetch as nativeFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { downloadSpeakingRemoteMedia } from './speakingImport';
import { getInstallationToken } from './installation';
import { downloadedSpeakingMedia } from '@/features/speaking/importMedia';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('./installation', () => ({ getInstallationToken: jest.fn() }));
jest.mock('@/features/speaking/importMedia', () => ({ downloadedSpeakingMedia: jest.fn() }));
const originalFetch = global.fetch;
const originalOrigin = process.env.EXPO_PUBLIC_API_BASE_URL;
const webFetch = jest.fn();
beforeEach(() => {
  jest.resetAllMocks(); process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
  jest.mocked(getInstallationToken).mockResolvedValue('test-private-bearer');
  jest.mocked(downloadedSpeakingMedia).mockResolvedValue({ asset: { name: '网页音视频.wav', uri: 'file:///download.wav', lastModified: 0 }, release: jest.fn() });
  global.fetch = webFetch; jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { global.fetch = originalFetch; if (originalOrigin === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL; else process.env.EXPO_PUBLIC_API_BASE_URL = originalOrigin; });
const response = () => ({ ok: true, headers: new Headers({ 'content-type': 'audio/wav' }), arrayBuffer: jest.fn(async () => new Uint8Array([1, 2, 3]).buffer) } as unknown as Response);
it('downloads authenticated binary media on native and web and creates a releasable file', async () => {
  const reply = response(); jest.mocked(nativeFetch).mockResolvedValue(reply as Awaited<ReturnType<typeof nativeFetch>>);
  await downloadSpeakingRemoteMedia(' https://example.com/podcast ');
  expect(nativeFetch).toHaveBeenCalledWith('https://api.example.test/v1/speaking/remote-media', expect.objectContaining({ method: 'POST',
    headers: { Authorization: 'Bearer test-private-bearer', 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/podcast' }) }));
  expect(downloadedSpeakingMedia).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'audio/wav');
  jest.replaceProperty(Platform, 'OS', 'web'); webFetch.mockResolvedValue(response());
  await downloadSpeakingRemoteMedia('https://example.com/video'); expect(webFetch).toHaveBeenCalledTimes(1);
});
it('validates links before credentials and surfaces a bounded download failure without leaking the bearer', async () => {
  await expect(downloadSpeakingRemoteMedia('file:///private/movie')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' }); expect(getInstallationToken).not.toHaveBeenCalled();
  await expect(downloadSpeakingRemoteMedia('invalid-url')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: '请填写公开的 HTTP(S) 音视频或网页链接' });
  jest.mocked(nativeFetch).mockResolvedValue({ ok: false, json: async () => ({ error: { code: 'IMPORT_TOO_LARGE', message: 'too large test-private-bearer', retryable: false, requestId: '11111111-1111-4111-8111-111111111111' } }) } as Awaited<ReturnType<typeof nativeFetch>>);
  await expect(downloadSpeakingRemoteMedia('https://example.com/video')).rejects.toMatchObject({ code: 'IMPORT_TOO_LARGE', message: 'too large [REDACTED]' });
  expect(downloadedSpeakingMedia).not.toHaveBeenCalled();
});
it('cancels before fetching when requested and rejects unexpected response types', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(downloadSpeakingRemoteMedia('https://example.com/video', { signal: controller.signal })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '下载已取消或超时，可以重试' });
  expect(nativeFetch).not.toHaveBeenCalled();
  jest.mocked(nativeFetch).mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) } as Awaited<ReturnType<typeof nativeFetch>>);
  await expect(downloadSpeakingRemoteMedia('https://example.com/video')).rejects.toMatchObject({ code: 'INVALID_SERVER_RESPONSE' });
  expect(downloadedSpeakingMedia).not.toHaveBeenCalled();
});

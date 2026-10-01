import { readSpeakingMediaDuration } from './mediaStorage';

const mockListeners: Record<string, (event: unknown) => void> = {};
const mockRemoveListener = jest.fn();
const mockVideo = { status: 'loading', duration: 0, release: jest.fn(), addListener: jest.fn() };
const mockAudio = { isLoaded: false, duration: 0, remove: jest.fn(), addListener: jest.fn() };
jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn(() => mockVideo) }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockAudio) }));
beforeEach(() => {
  jest.clearAllMocks();
  for (const name of Object.keys(mockListeners)) delete mockListeners[name];
  mockVideo.status = 'loading'; mockVideo.duration = 0; mockAudio.isLoaded = false; mockAudio.duration = 0;
  const listen = (name: string, callback: (event: unknown) => void) => { mockListeners[name] = callback; return { remove: mockRemoveListener }; };
  mockVideo.addListener.mockImplementation(listen); mockAudio.addListener.mockImplementation(listen);
});
async function loaded() { for (let index = 0; index < 5; index += 1) await Promise.resolve(); }
it('reads native video sourceLoad metadata without playing and releases the SDK player and subscriptions', async () => {
  const result = readSpeakingMediaDuration({ uri: 'file:///movie.mp4', name: 'movie.mp4', lastModified: 0 });
  await loaded();
  expect(mockListeners.sourceLoad).toBeDefined();
  mockListeners.sourceLoad!({ duration: 8529.479292 });
  await expect(result).resolves.toBe(8529.479);
  expect(mockVideo.release).toHaveBeenCalledTimes(1);
  expect(mockRemoveListener).toHaveBeenCalledTimes(2);
});
it('reads SDK audio status and frees resources after an invalid or unreadable file', async () => {
  let result = readSpeakingMediaDuration({ uri: 'file:///recording.m4a', name: 'recording.m4a', lastModified: 0 });
  await loaded(); mockListeners.playbackStatusUpdate!({ isLoaded: true, duration: 1.234 });
  await expect(result).resolves.toBe(1.234);
  expect(mockAudio.remove).toHaveBeenCalledTimes(1);
  result = readSpeakingMediaDuration({ uri: 'file:///private.m4a', name: 'private.m4a', lastModified: 0 });
  await loaded(); mockListeners.playbackStatusUpdate!({ error: 'file:///private-secret.m4a' });
  await expect(result).rejects.toThrow('音视频无法读取');
  expect(mockAudio.remove).toHaveBeenCalledTimes(2);
});
it('rejects invalid native duration and removes resources on cancellation', async () => {
  const invalid = readSpeakingMediaDuration({ uri: 'file:///movie.mp4', name: 'movie.mp4', lastModified: 0 });
  await loaded(); mockListeners.sourceLoad!({ duration: Number.POSITIVE_INFINITY });
  await expect(invalid).rejects.toThrow('有效时长');
  const controller = new AbortController();
  const canceled = readSpeakingMediaDuration({ uri: 'file:///movie.mp4', name: 'movie.mp4', lastModified: 0 }, { signal: controller.signal });
  await loaded(); controller.abort();
  await expect(canceled).rejects.toThrow('已取消');
  expect(mockVideo.release).toHaveBeenCalledTimes(2);
  expect(mockRemoveListener).toHaveBeenCalledTimes(4);
});

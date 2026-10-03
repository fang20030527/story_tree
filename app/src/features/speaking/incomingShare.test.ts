import * as Sharing from 'expo-sharing';
import { readIncomingSpeakingShare } from './incomingShare';
import { captureSharedSpeakingFile } from './importMedia';
jest.mock('expo-sharing', () => ({ getSharedPayloads: jest.fn(), clearSharedPayloads: jest.fn() }));
jest.mock('./importMedia', () => ({ captureSharedSpeakingFile: jest.fn() }));
beforeEach(() => { jest.resetAllMocks(); });
it('captures an audio/subtitle pair before clearing the system share and releases only cache copies', async () => {
  jest.mocked(Sharing.getSharedPayloads).mockReturnValue([{ shareType: 'audio', value: 'file:///Podcast.mp3', mimeType: 'audio/mpeg' }, { shareType: 'file', value: 'content://files/Podcast.srt', mimeType: 'text/plain' }]);
  const mediaRelease = jest.fn(); const subtitleRelease = jest.fn();
  jest.mocked(captureSharedSpeakingFile).mockResolvedValueOnce({ asset: { uri: 'file:///cache/audio', name: 'Podcast.mp3', size: 100, lastModified: 0 }, release: mediaRelease })
    .mockResolvedValueOnce({ asset: { uri: 'file:///cache/subtitle', name: 'Podcast.srt', size: 100, lastModified: 0 }, release: subtitleRelease });
  const incoming = await readIncomingSpeakingShare();
  expect(incoming?.media?.asset.name).toBe('Podcast.mp3'); expect(incoming?.subtitle?.asset.name).toBe('Podcast.srt');
  expect(Sharing.clearSharedPayloads).toHaveBeenCalledTimes(1); expect(mediaRelease).not.toHaveBeenCalled();
  incoming?.release(); expect(mediaRelease).toHaveBeenCalledTimes(1); expect(subtitleRelease).toHaveBeenCalledTimes(1);
});
it('accepts a shared link and a subtitle-only share', async () => {
  jest.mocked(Sharing.getSharedPayloads).mockReturnValue([{ shareType: 'text', value: 'Listen here: https://example.com/audio.mp3' }]);
  expect((await readIncomingSpeakingShare())?.url).toBe('https://example.com/audio.mp3'); expect(captureSharedSpeakingFile).not.toHaveBeenCalled();
  jest.mocked(Sharing.getSharedPayloads).mockReturnValue([{ shareType: 'file', value: 'file:///subtitles.vtt' }]);
  jest.mocked(captureSharedSpeakingFile).mockResolvedValue({ asset: { uri: 'file:///cache/subtitle', name: 'subtitles.vtt', size: 100, lastModified: 0 }, release: jest.fn() });
  expect((await readIncomingSpeakingShare())?.subtitle?.asset.name).toBe('subtitles.vtt');
});
it('rejects ambiguous multi-file shares and preserves the payload when capture fails', async () => {
  const release = jest.fn();
  jest.mocked(Sharing.getSharedPayloads).mockReturnValue([{ shareType: 'audio', value: 'file:///one.mp3' }, { shareType: 'audio', value: 'file:///two.mp3' }]);
  jest.mocked(captureSharedSpeakingFile).mockResolvedValue({ asset: { uri: 'file:///cache/audio', name: 'one.mp3', size: 100, lastModified: 0 }, release });
  await expect(readIncomingSpeakingShare()).rejects.toThrow('每次只支持一份');
  expect(Sharing.clearSharedPayloads).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
  expect(captureSharedSpeakingFile).toHaveBeenCalledTimes(1);
  jest.mocked(Sharing.getSharedPayloads).mockReturnValue([{ shareType: 'file', value: 'file:///missing.wav' }]);
  jest.mocked(captureSharedSpeakingFile).mockRejectedValue(new Error('分享文件无法读取'));
  await expect(readIncomingSpeakingShare()).rejects.toThrow('分享文件无法读取'); expect(Sharing.clearSharedPayloads).not.toHaveBeenCalled();
});

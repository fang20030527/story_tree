import * as ImagePicker from 'expo-image-picker';
import { captureSharedSpeakingFile, downloadedSpeakingMedia, pickSpeakingAlbum } from './importMedia';
const mockFiles: { uri: string; size: number; exists: boolean; copy: jest.Mock; create: jest.Mock; write: jest.Mock; delete: jest.Mock }[] = [];
let mockSize = 100;
let mockCopy: (target: typeof mockFiles[number]) => Promise<void>;
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), VideoExportPreset: { Passthrough: 0 }, UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' } }));
jest.mock('expo-file-system', () => {
  class File {
    uri: string; size = mockSize; exists = false;
    copy = jest.fn((target: typeof mockFiles[number]) => mockCopy(target));
    create = jest.fn(() => { this.exists = true; });
    write = jest.fn(async () => undefined);
    delete = jest.fn(() => { this.exists = false; });
    constructor(parent: string | { uri: string }, name?: string) { this.uri = typeof parent === 'string' ? parent : `${parent.uri}/${name}`; mockFiles.push(this); }
  }
  class Directory { uri: string; create = jest.fn(); constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; } }
  return { File, Directory, Paths: { cache: 'file:///cache' } };
});
jest.mock('./model', () => ({ speakingId: () => 'import-id' }));
beforeEach(() => { jest.clearAllMocks(); mockFiles.length = 0; mockSize = 100; mockCopy = async target => { target.exists = true; }; });
it('selects the original album video and treats cancellation as no change', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///album.mov', type: 'video', fileName: 'Album.mov', mimeType: 'video/quicktime', fileSize: 100, width: 640, height: 480 }] }).mockResolvedValueOnce({ canceled: true, assets: null });
  await expect(pickSpeakingAlbum()).resolves.toMatchObject({ name: 'Album.mov', mimeType: 'video/quicktime', size: 100 });
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['videos'], videoExportPreset: 0, allowsEditing: false }));
  await expect(pickSpeakingAlbum()).resolves.toBeUndefined();
});
it('waits for a share cache copy before releasing it and preserves the source', async () => {
  let finish!: () => void;
  mockCopy = target => new Promise(resolve => { finish = () => { target.exists = true; resolve(); }; });
  let settled = false;
  const pending = captureSharedSpeakingFile('content://files/podcast', 'Podcast.mp3', 'audio/mpeg').then(result => { settled = true; return result; });
  await Promise.resolve(); expect(settled).toBe(false); finish();
  const selected = await pending; expect(selected.asset.uri).toBe('file:///cache/speaking-imports/import-id.mp3');
  selected.release(); expect(mockFiles[1]!.delete).toHaveBeenCalledTimes(1); expect(mockFiles[0]!.delete).not.toHaveBeenCalled();
});
it('checks limits before copying shares and cleans a partial failed copy', async () => {
  mockSize = 4 * 1024 ** 3;
  await expect(captureSharedSpeakingFile('file:///huge.mp4', 'huge.mp4', 'video/mp4')).rejects.toThrow('不能超过 3 GB');
  expect(mockFiles[0]!.copy).not.toHaveBeenCalled();
  mockSize = 600 * 1024;
  await expect(captureSharedSpeakingFile('file:///huge.srt', 'huge.srt', 'text/plain')).rejects.toThrow('不能超过 512 KB');
  mockSize = 100;
  mockCopy = async target => { target.exists = true; throw new Error('disk full'); };
  await expect(captureSharedSpeakingFile('file:///small.mp3', 'small.mp3', 'audio/mpeg')).rejects.toThrow('disk full');
  expect(mockFiles.at(-1)!.delete).toHaveBeenCalledTimes(1);
});
it('stores a downloaded file in cache with a matching audio format', async () => {
  const selected = await downloadedSpeakingMedia(new Uint8Array([1, 2, 3]), 'audio/wav');
  expect(selected.asset).toMatchObject({ name: '网页音视频.wav', size: 3, mimeType: 'audio/wav' });
  expect(mockFiles[0]!.create).toHaveBeenCalledTimes(1); expect(mockFiles[0]!.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  selected.release(); expect(mockFiles[0]!.delete).toHaveBeenCalledTimes(1);
});

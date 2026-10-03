import { persistSpeakingMedia } from './mediaStorage';

type MockFile = { uri: string; size: number; exists: boolean; copy: jest.Mock; delete: jest.Mock };
const mockFiles: MockFile[] = [];
let mockCopy: (target: MockFile) => Promise<void>;
jest.mock('expo-file-system', () => {
  class File {
    uri: string; size = 1024; exists = false; delete = jest.fn(() => { this.exists = false; });
    copy = jest.fn((target: MockFile) => mockCopy(target));
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}/${name}`;
      mockFiles.push(this as unknown as MockFile);
    }
  }
  class Directory { uri: string; create = jest.fn(); constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; } }
  return { File, Directory, Paths: { document: 'file:///documents' } };
});
jest.mock('./model', () => ({ speakingId: () => 'media-id' }));
beforeEach(() => { mockFiles.length = 0; });

it('waits for the asynchronous native copy before returning the persisted path', async () => {
  let finish!: () => void;
  mockCopy = target => new Promise(resolve => { finish = () => { target.exists = true; resolve(); }; });
  let settled = false;
  const result = persistSpeakingMedia({ uri: 'file:///picked/talk.mp3', name: 'talk.mp3', lastModified: 0 }).then(uri => { settled = true; return uri; });
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  expect(mockFiles[0]!.copy).toHaveBeenCalledWith(mockFiles[1]);
  expect(settled).toBe(false);
  finish();
  await expect(result).resolves.toBe('file:///documents/speaking/media-id.mp3');
  expect(mockFiles[1]!.exists).toBe(true);
});
it('surfaces a failed copy and removes the partial target', async () => {
  mockCopy = async target => { target.exists = true; throw new Error('disk full'); };
  await expect(persistSpeakingMedia({ uri: 'file:///picked/talk.m4a', name: 'talk.m4a', lastModified: 0 })).rejects.toThrow('disk full');
  expect(mockFiles[1]!.delete).toHaveBeenCalledTimes(1);
});

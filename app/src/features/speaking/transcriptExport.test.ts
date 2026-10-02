import { exportSpeakingTranscript } from './transcriptExport';
import { buildTranscriptHtml, transcriptDocxMimeType } from './transcriptDocument';
import type { SpeakingMaterial } from './model';
import { printToFileAsync } from 'expo-print';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

const mockFileWrite = jest.fn();
const mockFileCopy = jest.fn();
const mockFileDelete = jest.fn();
const mockDirectoryDelete = jest.fn();
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  Directory: class {
    uri: string; exists = true;
    constructor(...paths: string[]) { this.uri = paths.join('/'); }
    create() {} delete() { mockDirectoryDelete(this.uri); }
  },
  File: class {
    uri: string; exists = true;
    constructor(parent: string | { uri: string }, name?: string) { this.uri = (typeof parent === 'string' ? parent : parent.uri) + (name ? `/${name}` : ''); }
    create() {} write(bytes: Uint8Array) { mockFileWrite(bytes); }
    copy(target: { uri: string }) { mockFileCopy(this.uri, target.uri); }
    delete() { mockFileDelete(this.uri); }
  },
}));
const material: SpeakingMaterial = { id: 'test', title: '测试素材', subtitle: '', category: '文件',
  origin: 'file', mediaType: 'audio', duration: 5, cues: [{ id: 'one', start: 0, end: 5, en: 'Hello!', zh: '你好！' }] };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isAvailableAsync).mockResolvedValue(true);
  jest.mocked(shareAsync).mockResolvedValue(undefined);
  jest.mocked(printToFileAsync).mockResolvedValue({ uri: 'file:///cache/random.pdf', numberOfPages: 1 });
});

it('generates a named PDF from transcript HTML, opens file sharing and removes temporary files', async () => {
  const notes = { one: '重音' };
  await exportSpeakingTranscript(material, notes, 'pdf');
  expect(printToFileAsync).toHaveBeenCalledWith({ html: buildTranscriptHtml(material, notes), width: 595.28, height: 841.89 });
  expect(mockFileCopy).toHaveBeenCalledWith('file:///cache/random.pdf', expect.stringContaining('/测试素材 台词本.pdf'));
  expect(shareAsync).toHaveBeenCalledWith(expect.stringContaining('/测试素材 台词本.pdf'), expect.objectContaining({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }));
  expect(mockFileDelete).toHaveBeenCalledWith('file:///cache/random.pdf');
  expect(mockDirectoryDelete).toHaveBeenCalledTimes(1);
});

it('writes real Word bytes and uses the DOCX MIME type when sharing', async () => {
  await exportSpeakingTranscript(material, {}, 'word');
  expect(Array.from((mockFileWrite.mock.calls[0][0] as Uint8Array).slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(printToFileAsync).not.toHaveBeenCalled();
  expect(shareAsync).toHaveBeenCalledWith(expect.stringContaining('/测试素材 台词本.docx'), expect.objectContaining({ mimeType: transcriptDocxMimeType, UTI: 'org.openxmlformats.wordprocessingml.document' }));
  expect(mockDirectoryDelete).toHaveBeenCalledTimes(1);
});

it('cleans up on failed sharing and creates no files when sharing is unavailable', async () => {
  jest.mocked(shareAsync).mockRejectedValueOnce(new Error('share failed'));
  await expect(exportSpeakingTranscript(material, {}, 'word')).rejects.toThrow('share failed');
  expect(mockDirectoryDelete).toHaveBeenCalledTimes(1);
  jest.clearAllMocks(); jest.mocked(isAvailableAsync).mockResolvedValue(false);
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow('当前设备无法保存或分享');
  expect(printToFileAsync).not.toHaveBeenCalled();
  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
});

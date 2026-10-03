import { exportSpeakingTranscript } from './transcriptExport';
import { buildTranscriptHtml, transcriptDocxMimeType } from './transcriptDocument';
import type { SpeakingMaterial } from './model';
import { printToFileAsync } from 'expo-print';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

const mockFileWrite = jest.fn();
const mockFileCopy = jest.fn();
const mockFileDelete = jest.fn();
const mockDirectoryDelete = jest.fn();
const mockCopyDone = jest.fn();
let mockCopyResult: () => Promise<void> = () => Promise.resolve();
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
    // Matches expo-file-system 57, where File#copy resolves asynchronously.
    copy(target: { uri: string }) { mockFileCopy(this.uri, target.uri); return mockCopyResult().then(() => mockCopyDone(target.uri)); }
    delete() { mockFileDelete(this.uri); }
  },
}));
const material: SpeakingMaterial = { id: 'test', title: '测试素材', subtitle: '', category: '文件',
  origin: 'file', mediaType: 'audio', duration: 5, cues: [{ id: 'one', start: 0, end: 5, en: 'Hello!', zh: '你好！' }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockCopyResult = () => new Promise(resolve => setTimeout(resolve, 0));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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
  // The share sheet must only receive the PDF after the asynchronous copy finished.
  expect(mockCopyDone.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(shareAsync).mock.invocationCallOrder[0]);
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
  await expect(exportSpeakingTranscript(material, {}, 'word')).rejects.toThrow('无法打开分享面板，请重试');
  expect(mockDirectoryDelete).toHaveBeenCalledTimes(1);
  jest.clearAllMocks(); jest.mocked(isAvailableAsync).mockResolvedValue(false);
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow('当前设备无法保存或分享');
  expect(printToFileAsync).not.toHaveBeenCalled();
  expect(mockFileWrite).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
});

it('reports which PDF step failed, with the native error code but without file paths', async () => {
  jest.mocked(printToFileAsync).mockRejectedValueOnce(Object.assign(new Error('render failed at file:///private/cache'), { code: 'ERR_PDF_NOT_RENDERED' }));
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow(/^PDF 生成失败，请重试（ERR_PDF_NOT_RENDERED）$/);
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDirectoryDelete).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith('[台词本导出] PDF 生成失败，请重试', expect.any(Error));

  mockCopyResult = () => Promise.reject(Object.assign(new Error('copy failed'), { code: 'ERR_FILE_COPY' }));
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow('PDF 保存失败，请检查手机存储空间后重试（ERR_FILE_COPY）');
  expect(shareAsync).not.toHaveBeenCalled();

  mockCopyResult = () => Promise.resolve();
  jest.mocked(shareAsync).mockRejectedValueOnce(Object.assign(new Error("You don't have access to the provided file"), { code: 'ERR_FILE_PERMISSION' }));
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow('无法打开分享面板，请重试（ERR_FILE_PERMISSION）');
});

it('asks for an app update when an installed build lacks the native export modules', async () => {
  jest.mocked(printToFileAsync).mockRejectedValueOnce(new Error("Cannot find native module 'ExpoPrint'"));
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow('当前 App 版本缺少导出组件，请更新到最新版本后重试');
  jest.mocked(isAvailableAsync).mockRejectedValueOnce(new Error("Cannot find native module 'ExpoSharing'"));
  await expect(exportSpeakingTranscript(material, {}, 'word')).rejects.toThrow('当前 App 版本缺少导出组件');
});

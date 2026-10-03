/** @jest-environment jsdom */
import { TextDecoder, TextEncoder } from 'node:util';
import { Blob as NodeBlob } from 'node:buffer';
import { exportSpeakingTranscript } from './transcriptExport.web';
import { buildTranscriptHtml, transcriptDocxMimeType, transcriptMarkdownMimeType } from './transcriptDocument';
import type { SpeakingMaterial } from './model';

const material: SpeakingMaterial = { id: 'test', title: '测试素材', subtitle: '', category: '文件',
  origin: 'file', mediaType: 'audio', duration: 5, cues: [{ id: 'one', start: 0, end: 5, en: 'Hello!', zh: '你好！' }] };
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true });
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('downloads a real DOCX with a meaningful filename and releases its object URL after the download starts', async () => {
  const create = jest.fn<string, [Blob]>(() => 'blob:transcript');
  const revoke = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  let filename = '';
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  await exportSpeakingTranscript(material, {}, 'word');
  expect(click).toHaveBeenCalledTimes(1);
  expect(filename).toBe('测试素材 台词本.docx');
  const blob = create.mock.calls[0][0] as Blob;
  expect(blob.type).toBe(transcriptDocxMimeType);
  expect(blob.size).toBeGreaterThan(1000);
  expect(document.querySelector('a')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(revoke).toHaveBeenCalledWith('blob:transcript');
});

it('直接下载 UTF-8 Markdown，保留双语字幕与笔记并释放下载资源', async () => {
  const create = jest.fn<string, [Blob]>(() => 'blob:markdown');
  const revoke = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  let filename = '';
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  const open = jest.spyOn(window, 'open');
  await exportSpeakingTranscript(material, { one: '注意连读' }, 'markdown');
  expect(click).toHaveBeenCalledTimes(1);
  expect(filename).toBe('测试素材 台词本.md');
  const blob = create.mock.calls[0][0] as Blob;
  expect(blob.type).toBe(`${transcriptMarkdownMimeType};charset=utf-8`);
  const content = await blob.text();
  expect(content).toContain('# 测试素材 台词本');
  expect(content).toContain('## 1  00:00 - 00:05');
  expect(content).toContain('Hello\\!\n\n你好！');
  expect(content).toContain('> **笔记：** 注意连读');
  expect(open).not.toHaveBeenCalled();
  expect(document.querySelector('a')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(revoke).toHaveBeenCalledWith('blob:markdown');
});

it('prints an isolated transcript document rather than the application UI', async () => {
  const preview = { opener: window, document: { open: jest.fn(), write: jest.fn(), close: jest.fn(), fonts: { ready: Promise.resolve() } }, focus: jest.fn(), print: jest.fn(), close: jest.fn() };
  const open = jest.spyOn(window, 'open').mockReturnValue(preview as unknown as Window);
  const notes = { one: '重音' };
  await exportSpeakingTranscript(material, notes, 'pdf');
  expect(open).toHaveBeenCalledWith('', '_blank');
  expect(preview.opener).toBeNull();
  expect(preview.document.write).toHaveBeenCalledWith(buildTranscriptHtml(material, notes));
  expect(preview.print).toHaveBeenCalledTimes(1);
  expect(preview.close).not.toHaveBeenCalled();
});

it('reports popup blocking and printing failures without leaking underlying errors', async () => {
  const open = jest.spyOn(window, 'open').mockReturnValue(null);
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow('请允许弹出窗口后重试');
  const preview = { document: { open: jest.fn(), write: jest.fn(), close: jest.fn() }, focus: jest.fn(), print: jest.fn(() => { throw new Error('internal error'); }), close: jest.fn() };
  open.mockReturnValue(preview as unknown as Window);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(exportSpeakingTranscript(material, {}, 'pdf')).rejects.toThrow(/^PDF 导出失败，请重试，或换一个支持打印的浏览器$/);
  expect(preview.close).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('PDF 导出失败'), expect.objectContaining({ message: 'internal error' }));
  warn.mockRestore();
});

/** @jest-environment jsdom */
import type { DocumentPickerAsset } from 'expo-document-picker';
import { TextDecoder, TextEncoder } from 'node:util';
import { readSpeakingMediaDuration } from './mediaStorage.web';
import { SPEAKING_METADATA_TIMEOUT_MS } from './mediaDuration';

Object.assign(globalThis, { TextDecoder, TextEncoder });
const createElement = document.createElement.bind(document);
const objectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const createObjectURL = jest.fn(() => 'blob:private-local-movie');
const revokeObjectURL = jest.fn();
let media: HTMLMediaElement;
let metadataDuration = 8529.479292;
let pending = false;
const readAll = jest.fn(() => { throw new Error('must not buffer a movie'); });
function selected(type = 'video/mp4'): DocumentPickerAsset {
  const file = new File(['synthetic-media'], type === 'audio/webm' ? 'recording.webm' : 'movie.mp4', { type });
  Object.defineProperty(file, 'arrayBuffer', { value: readAll });
  return { file, mimeType: type, name: file.name, uri: 'blob:original', lastModified: 0 };
}
beforeEach(() => {
  jest.clearAllMocks(); metadataDuration = 8529.479292; pending = false;
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
  jest.spyOn(document, 'createElement').mockImplementation((name: string) => {
    const element = createElement(name);
    if (name === 'video' || name === 'audio') {
      media = element as HTMLMediaElement;
      let ready = false;
      Object.defineProperty(media, 'readyState', { get: () => ready ? 1 : 0 });
      Object.defineProperty(media, 'duration', { get: () => metadataDuration });
      jest.spyOn(media, 'load').mockImplementation(() => {
        if (!pending && media.hasAttribute('src')) queueMicrotask(() => { ready = true; media.dispatchEvent(new Event('loadedmetadata')); });
      });
    }
    return element;
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
afterAll(() => {
  if (objectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', objectUrlDescriptor); else delete (URL as Partial<typeof URL>).createObjectURL;
  if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor); else delete (URL as Partial<typeof URL>).revokeObjectURL;
});
it('uses browser metadata through the original File object URL and releases it without reading the full movie', async () => {
  const asset = selected();
  await expect(readSpeakingMediaDuration(asset)).resolves.toBe(8529.479);
  expect(createObjectURL).toHaveBeenCalledWith(asset.file);
  expect(readAll).not.toHaveBeenCalled();
  expect(media.tagName).toBe('VIDEO');
  expect(media.preload).toBe('metadata');
  expect(media.hasAttribute('src')).toBe(false);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:private-local-movie');
});
it.each([0, Number.NaN, Number.POSITIVE_INFINITY, 86_401])('rejects invalid file metadata %s and releases the object URL', async duration => {
  metadataDuration = duration;
  await expect(readSpeakingMediaDuration(selected())).rejects.toThrow('有效时长');
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(media.hasAttribute('src')).toBe(false);
});
it('allows a known WebM recording duration only when metadata is missing', async () => {
  metadataDuration = Number.POSITIVE_INFINITY;
  await expect(readSpeakingMediaDuration(selected('audio/webm'), { durationHintSeconds: 12.345 })).resolves.toBe(12.345);
  metadataDuration = 20;
  await expect(readSpeakingMediaDuration(selected('audio/webm'), { durationHintSeconds: 12.345 })).resolves.toBe(20);
  metadataDuration = Number.POSITIVE_INFINITY;
  await expect(readSpeakingMediaDuration(selected('video/mp4'), { durationHintSeconds: 12 })).rejects.toThrow('有效时长');
  await expect(readSpeakingMediaDuration(selected('audio/webm'), { durationHintSeconds: 601 })).rejects.toThrow('录音时长无效');
});
it('cancels a metadata probe and releases its local URL without waiting for an event', async () => {
  pending = true;
  const controller = new AbortController();
  const result = readSpeakingMediaDuration(selected(), { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toThrow('已取消');
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(media.hasAttribute('src')).toBe(false);
});
it('times out metadata that never arrives and reports unreadable media without exposing its URI', async () => {
  pending = true; jest.useFakeTimers();
  const result = expect(readSpeakingMediaDuration(selected())).rejects.toThrow('读取音视频时长超时');
  jest.advanceTimersByTime(SPEAKING_METADATA_TIMEOUT_MS);
  await result;
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  const failed = readSpeakingMediaDuration(selected());
  media.dispatchEvent(new Event('error'));
  await expect(failed).rejects.toThrow('音视频无法读取');
});

import type { DocumentPickerAsset } from 'expo-document-picker';
import { SpeakingMediaTypeSchema } from '@context-reader/contracts';
import { speakingContentType } from './mediaTypes';
import { decodeSpeakingSubtitle } from './subtitleEncoding';
import { speakingId } from './model';
import { waitForSpeakingDuration, type SpeakingDurationOptions } from './mediaDuration';

export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export async function speakingMediaInfo(asset: DocumentPickerAsset) {
  const blob = asset.file ?? await (await fetch(asset.uri)).blob();
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0) throw new Error('无法读取所选音视频');
  return { byteSize: blob.size, contentType: SpeakingMediaTypeSchema.parse(speakingContentType(asset.name, asset.mimeType || blob.type)) };
}
export async function readSpeakingMediaDuration(asset: DocumentPickerAsset, options: SpeakingDurationOptions = {}) {
  const blob = asset.file ?? await (await fetch(asset.uri, { signal: options.signal })).blob();
  const contentType = speakingContentType(asset.name, asset.mimeType || blob.type);
  const media = document.createElement(contentType.startsWith('video/') ? 'video' : 'audio');
  const uri = URL.createObjectURL(blob);
  media.preload = 'metadata';
  try {
    return await waitForSpeakingDuration(() => media.readyState >= 1 ? media.duration : null, (loaded, failed) => {
      media.addEventListener('loadedmetadata', loaded);
      media.addEventListener('durationchange', loaded);
      media.addEventListener('error', failed);
      media.src = uri;
      media.load();
      return () => {
        media.removeEventListener('loadedmetadata', loaded);
        media.removeEventListener('durationchange', loaded);
        media.removeEventListener('error', failed);
      };
    }, contentType, options);
  } finally {
    media.removeAttribute('src'); media.load(); URL.revokeObjectURL(uri);
  }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('black-hole-speaking-media', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('media');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器文件存储不可用'));
  });
}
export async function persistSpeakingMedia(asset: DocumentPickerAsset) {
  const blob = asset.file ?? await (await fetch(asset.uri)).blob();
  if (blob.size > MAX_MEDIA_BYTES) throw new Error('文件不能超过 100 MB');
  const id = speakingId();
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('media', 'readwrite');
      transaction.objectStore('media').put(blob, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('文件保存失败，请检查浏览器剩余空间'));
    });
  } finally { db.close(); }
  return id;
}
export async function resolveSpeakingMedia(id: string) {
  const db = await database();
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const request = db.transaction('media').objectStore('media').get(id);
      request.onsuccess = () => request.result instanceof Blob ? resolve(request.result) : reject(new Error('文件已不可用，请重新导入'));
      request.onerror = () => reject(new Error('文件读取失败，请重试'));
    });
    const uri = URL.createObjectURL(blob);
    return { uri, release: () => URL.revokeObjectURL(uri) };
  } finally { db.close(); }
}
export async function readSpeakingSubtitle(asset: DocumentPickerAsset) {
  const blob = asset.file ?? await (await fetch(asset.uri)).blob();
  if (blob.size > 512 * 1024) throw new Error('字幕文件不能超过 512 KB');
  return decodeSpeakingSubtitle(new Uint8Array(await blob.arrayBuffer()));
}

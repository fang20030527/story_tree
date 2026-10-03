import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { SPEAKING_MAX_MEDIA_BYTES, SPEAKING_MAX_SUBTITLE_BYTES } from '@context-reader/contracts';
import { speakingId } from './model';
import { speakingContentType, speakingMediaExtension } from './mediaTypes';

export type SelectedSpeakingMedia = { asset: DocumentPickerAsset; release: () => void };
export async function pickSpeakingAlbum(): Promise<DocumentPickerAsset | undefined> {
  // 系统照片选择器无需读取整个相册，视频保持原文件，避免额外转码。
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false,
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current });
  if (result.canceled) return undefined;
  const item = result.assets[0];
  if (!item || item.type !== 'video') throw new Error('请选择相册中的视频');
  const name = item.fileName || `相册视频.${speakingMediaExtension(item.mimeType ?? 'video/mp4') || 'mp4'}`;
  return { uri: item.uri, name, lastModified: item.file?.lastModified ?? Date.now(), ...(item.mimeType ? { mimeType: item.mimeType } : {}),
    ...(item.fileSize !== undefined ? { size: item.fileSize } : {}), ...(item.file ? { file: item.file } : {}) };
}

export async function downloadedSpeakingMedia(bytes: Uint8Array, contentType: string): Promise<SelectedSpeakingMedia> {
  const extension = speakingMediaExtension(contentType);
  if (!extension) throw new Error('链接返回了不支持的音视频格式');
  const directory = new Directory(Paths.cache, 'speaking-imports');
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `${speakingId()}.${extension}`);
  try { file.create(); await file.write(bytes); }
  catch (error) { if (file.exists) file.delete(); throw error; }
  return { asset: { uri: file.uri, name: `网页音视频.${extension}`, size: bytes.byteLength, mimeType: contentType, lastModified: Date.now() },
    release: () => { try { if (file.exists) file.delete(); } catch { /* 缓存清理由系统兜底。 */ } } };
}

export async function captureSharedSpeakingFile(uri: string, name: string, mimeType?: string): Promise<SelectedSpeakingMedia> {
  if (!/^(?:file|content):/iu.test(uri)) throw new Error('分享文件无法读取，请先存到系统文件，再从本地导入');
  const source = new File(uri);
  const size = source.size;
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('分享文件无法读取，请重新分享');
  const subtitle = /\.(?:srt|vtt)$/iu.test(name);
  if (size > (subtitle ? SPEAKING_MAX_SUBTITLE_BYTES : SPEAKING_MAX_MEDIA_BYTES)) throw new Error(subtitle ? '字幕文件不能超过 512 KB' : '音视频文件不能超过 3 GB');
  const type = subtitle ? 'text/plain' : speakingContentType(name, mimeType);
  const directory = new Directory(Paths.cache, 'speaking-imports');
  directory.create({ idempotent: true, intermediates: true });
  const extension = subtitle ? name.split('.').at(-1)! : speakingMediaExtension(type);
  const target = new File(directory, `${speakingId()}.${extension}`);
  try { await source.copy(target); }
  catch (error) { if (target.exists) target.delete(); throw error; }
  return { asset: { uri: target.uri, name, size, mimeType: type, lastModified: Date.now() },
    release: () => { try { if (target.exists) target.delete(); } catch { /* 保留可由系统清理的缓存。 */ } } };
}

import type { DocumentPickerAsset } from 'expo-document-picker';
import * as DocumentPicker from 'expo-document-picker';
import { speakingMediaExtension } from './mediaTypes';
import type { SelectedSpeakingMedia } from './importMedia';

export type { SelectedSpeakingMedia } from './importMedia';
export async function pickSpeakingAlbum(): Promise<DocumentPickerAsset | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true, base64: false });
  return result.canceled ? undefined : result.assets[0];
}
export async function downloadedSpeakingMedia(bytes: Uint8Array, contentType: string): Promise<SelectedSpeakingMedia> {
  const extension = speakingMediaExtension(contentType);
  if (!extension) throw new Error('链接返回了不支持的音视频格式');
  const file = new File([new Uint8Array(bytes)], `网页音视频.${extension}`, { type: contentType });
  const uri = URL.createObjectURL(file);
  return { asset: { uri, name: file.name, mimeType: contentType, size: file.size, file, lastModified: file.lastModified }, release: () => URL.revokeObjectURL(uri) };
}
export async function captureSharedSpeakingFile(): Promise<SelectedSpeakingMedia> {
  throw new Error('请在黑洞英语手机 App 中接收分享，或在当前浏览器从本地选择文件');
}

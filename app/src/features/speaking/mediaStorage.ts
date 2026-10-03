import { Directory, File, Paths } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { SpeakingMediaTypeSchema } from '@context-reader/contracts';
import { speakingContentType } from './mediaTypes';
import { decodeSpeakingSubtitle } from './subtitleEncoding';
import { speakingId } from './model';
import { waitForSpeakingDuration, type SpeakingDurationOptions } from './mediaDuration';

export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export async function speakingMediaInfo(asset: DocumentPickerAsset) {
  const byteSize = new File(asset.uri).size;
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new Error('无法读取所选音视频');
  return { byteSize, contentType: SpeakingMediaTypeSchema.parse(speakingContentType(asset.name, asset.mimeType)) };
}
export async function readSpeakingMediaDuration(asset: DocumentPickerAsset, options: SpeakingDurationOptions = {}) {
  const contentType = speakingContentType(asset.name, asset.mimeType);
  if (contentType.startsWith('video/')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Initialize native media modules only when probing direct-upload metadata.
    const { createVideoPlayer } = require('expo-video') as typeof import('expo-video');
    const player = createVideoPlayer(asset.uri);
    let loadedDuration: number | null = player.status === 'readyToPlay' ? player.duration : null;
    try {
      return await waitForSpeakingDuration(() => loadedDuration, (loaded, failed) => {
        const metadata = player.addListener('sourceLoad', event => { loadedDuration = event.duration; loaded(); });
        const status = player.addListener('statusChange', event => {
          if (event.status === 'error') failed();
          else if (event.status === 'readyToPlay') { loadedDuration = player.duration; loaded(); }
        });
        return () => { metadata.remove(); status.remove(); };
      }, contentType, options);
    } finally { player.release(); }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Initialize native media modules only when probing direct-upload metadata.
  const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
  const player = createAudioPlayer(asset.uri, { updateInterval: 100 });
  let loadedDuration: number | null = player.isLoaded ? player.duration : null;
  try {
    return await waitForSpeakingDuration(() => loadedDuration, (loaded, failed) => {
      const status = player.addListener('playbackStatusUpdate', event => {
        if (event.error) failed();
        else if (event.isLoaded) { loadedDuration = event.duration; loaded(); }
      });
      return () => status.remove();
    }, contentType, options);
  } finally { player.remove(); }
}
export async function persistSpeakingMedia(asset: DocumentPickerAsset): Promise<string> {
  const source = new File(asset.uri);
  if (source.size > MAX_MEDIA_BYTES) throw new Error('文件不能超过 100 MB');
  const directory = new Directory(Paths.document, 'speaking');
  directory.create({ idempotent: true, intermediates: true });
  const extension = asset.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '.m4a';
  const target = new File(directory, `${speakingId()}${extension}`);
  // expo-file-system 57 的 File#copy 是异步的：必须等复制完成再返回路径，否则调用方可能拿到尚未写完的文件。
  try { await source.copy(target); }
  catch (error) {
    try { if (target.exists) target.delete(); } catch { /* 清理失败不覆盖原始错误。 */ }
    throw error;
  }
  return target.uri;
}
export async function resolveSpeakingMedia(id: string): Promise<{ uri: string; release: () => void }> {
  if (!new File(id).exists) throw new Error('文件已不可用，请重新导入');
  return { uri: id, release: () => undefined };
}
export async function readSpeakingSubtitle(asset: DocumentPickerAsset) {
  const file = new File(asset.uri);
  if (file.size > 512 * 1024) throw new Error('字幕文件不能超过 512 KB');
  return decodeSpeakingSubtitle(await file.bytes());
}

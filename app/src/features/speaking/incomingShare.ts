import * as Sharing from 'expo-sharing';
import { SPEAKING_MAX_MEDIA_BYTES, SPEAKING_MAX_SUBTITLE_BYTES } from '@context-reader/contracts';
import { captureSharedSpeakingFile, type SelectedSpeakingMedia } from './importMedia';
import { speakingMediaExtension } from './mediaTypes';

export type SpeakingIncomingShare = { media?: SelectedSpeakingMedia; subtitle?: SelectedSpeakingMedia; url?: string; release: () => void };
export async function readIncomingSpeakingShare(): Promise<SpeakingIncomingShare | undefined> {
  let payloads: Sharing.SharePayload[];
  try { payloads = Sharing.getSharedPayloads(); }
  catch { throw new Error('当前安装的 App 无法接收系统分享，请更新黑洞英语后重新分享'); }
  if (!payloads.length) return undefined;
  let media: SelectedSpeakingMedia | undefined;
  let subtitle: SelectedSpeakingMedia | undefined;
  let url: string | undefined;
  const captured: SelectedSpeakingMedia[] = [];
  try {
    if (payloads.length > 2) throw new Error('每次请分享一份音视频，可同时附带一份 SRT／VTT 字幕');
    for (const payload of payloads) {
      if (payload.shareType === 'url' || payload.shareType === 'text') {
        const address = payload.value.match(/https?:\/\/[^\s<>"'，。]+/iu)?.[0];
        if (!address || url || media) throw new Error('请选择一份音视频文件或一个网页链接分享');
        url = address; continue;
      }
      let name: string;
      try { name = decodeURIComponent(payload.value.split(/[?#]/u)[0]!.split('/').at(-1) ?? ''); }
      catch { throw new Error('分享文件名称无法读取，请从本地导入'); }
      if (!name.includes('.')) name = `分享文件.${speakingMediaExtension(payload.mimeType ?? '') || 'bin'}`;
      const isSubtitle = /\.(srt|vtt)$/iu.test(name);
      if (isSubtitle && subtitle) throw new Error('每次只支持一份不超过 512 KB 的 SRT／VTT 字幕');
      if (!isSubtitle && (media || url)) throw new Error('每次只支持一份不超过 3 GB 的音视频');
      const selected = await captureSharedSpeakingFile(payload.value, name, payload.mimeType);
      captured.push(selected);
      if (isSubtitle) {
        if ((selected.asset.size ?? 0) > SPEAKING_MAX_SUBTITLE_BYTES) throw new Error('每次只支持一份不超过 512 KB 的 SRT／VTT 字幕');
        subtitle = selected;
      } else {
        if ((selected.asset.size ?? 0) > SPEAKING_MAX_MEDIA_BYTES) throw new Error('每次只支持一份不超过 3 GB 的音视频');
        media = selected;
      }
    }
    Sharing.clearSharedPayloads();
    return { ...(media ? { media } : {}), ...(subtitle ? { subtitle } : {}), ...(url ? { url } : {}),
      release: () => captured.forEach(item => item.release()) };
  } catch (error) { captured.forEach(item => item.release()); throw error; }
}

export const speakingImportSources = [
  { id: 'drive', label: '网盘', icon: 'cloud-outline', hint: '从 iCloud Drive 或已接入系统文件的网盘选择音视频。' },
  { id: 'album', label: '相册', icon: 'images-outline', hint: '从手机相册选择视频，保留原始画质。' },
  { id: 'url', label: '网页链接', icon: 'link-outline', hint: '粘贴公开音视频下载地址，或包含音视频的网页链接。' },
  { id: 'local', label: '本地', icon: 'folder-outline', hint: '选择设备上的音频或视频文件。' },
  { id: 'computer', label: '电脑', icon: 'desktop-outline', hint: '在电脑网页端登录同一账号，上传后在手机继续练习。' },
  { id: 'shared', label: '其他 App', icon: 'apps-outline', hint: '从邮件、网盘、浏览器或聊天 App 分享音视频和字幕到黑洞英语。' },
] as const;
export type SpeakingImportSource = typeof speakingImportSources[number]['id'];
export function speakingImportSource(value: string | string[] | undefined): SpeakingImportSource {
  return speakingImportSources.find(source => source.id === value)?.id ?? 'local';
}

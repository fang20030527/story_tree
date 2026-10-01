import { SpeakingMediaTypeSchema } from '@context-reader/contracts';

const extensions: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
  ogg: 'audio/ogg', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};
export function speakingContentType(name: string, mimeType?: string) {
  const parsed = SpeakingMediaTypeSchema.safeParse(mimeType?.toLowerCase());
  if (parsed.success) return parsed.data;
  const type = extensions[name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!type) throw new Error('请选择 MP3、M4A、WAV、MP4、MOV 或 WebM 音视频');
  return type;
}

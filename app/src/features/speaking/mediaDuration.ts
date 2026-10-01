export type SpeakingDurationOptions = { signal?: AbortSignal; durationHintSeconds?: number };
export const SPEAKING_METADATA_TIMEOUT_MS = 30_000;

function durationSeconds(value: number, contentType: string, hint?: number) {
  // Chrome MediaRecorder WebM can omit duration. Only a known recording may supply it.
  if ((!Number.isFinite(value) || value <= 0) && contentType === 'audio/webm' && hint !== undefined) {
    if (!Number.isFinite(hint) || hint <= 0 || hint > 600) throw new Error('录音时长无效，请重新录制');
    value = hint;
  }
  if (!Number.isFinite(value) || value <= 0 || value > 86_400) throw new Error('无法读取有效时长，请选择 24 小时以内的音视频');
  return Math.max(0.001, Math.round(value * 1000) / 1000);
}

/** null means metadata has not loaded; zero/Infinity after loading is invalid. */
export async function waitForSpeakingDuration(
  read: () => number | null,
  listen: (loaded: () => void, failed: () => void) => () => void,
  contentType: string,
  options: SpeakingDurationOptions,
) {
  let cleanup = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await new Promise<number>((resolve, reject) => {
      abort = () => reject(new Error('上传已取消，可以重试'));
      if (options.signal?.aborted) { abort(); return; }
      options.signal?.addEventListener('abort', abort);
      timer = setTimeout(() => reject(new Error('读取音视频时长超时，请重试')), SPEAKING_METADATA_TIMEOUT_MS);
      const loaded = () => {
        try {
          const value = read();
          if (value !== null) resolve(durationSeconds(value, contentType, options.durationHintSeconds));
        } catch (error) { reject(error); }
      };
      cleanup = listen(loaded, () => reject(new Error('音视频无法读取，请选择可播放的文件')));
      loaded();
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    cleanup();
  }
}

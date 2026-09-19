/** 段落下标、起止字符位置、录音中的起止秒数。 */
export type EditorialAudioCue = readonly [number, number, number, number, number];

export function findAudioCue(cues: readonly EditorialAudioCue[], time: number): EditorialAudioCue | undefined {
  if (!Number.isFinite(time) || !cues.length) return undefined;
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cues[mid]![3] <= time) low = mid + 1;
    else high = mid;
  }
  const cue = cues[low - 1];
  // 词间短暂停顿保留当前位置，片头与片尾不高亮正文。
  return cue && time < cues[cues.length - 1]![4] ? cue : undefined;
}

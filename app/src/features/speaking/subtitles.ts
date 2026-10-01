import type { SpeakingCue } from './model';

export function parseSubtitleTime(value: string): number {
  const match = value.trim().match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error('时间格式请使用 00:00 或 00:00:00.000');
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] ?? '').padEnd(3, '0')) / 1000;
}
export function validateSpeakingCues(cues: SpeakingCue[], duration = 0): void {
  if (!cues.length) throw new Error('请导入字幕，或手动添加至少一句英文');
  if (cues.length > 10_000) throw new Error('字幕不能超过 10,000 句');
  const ids = new Set<string>();
  cues.forEach((cue, index) => {
    if (!cue.en.trim()) throw new Error(`第 ${index + 1} 句需要英文内容`);
    if (cue.en.length > 4_000 || cue.zh.length > 4_000) throw new Error(`第 ${index + 1} 句文字不能超过 4,000 字符`);
    if (ids.has(cue.id)) throw new Error('字幕编号重复，请重新导入');
    ids.add(cue.id);
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) throw new Error(`第 ${index + 1} 句的结束时间必须晚于开始时间`);
    if (cue.end > 86_400) throw new Error('字幕时间不能超过 24 小时');
    if (index && cue.start < cues[index - 1].start) throw new Error(`第 ${index + 1} 句需要按开始时间排序`);
    if (duration > 0 && cue.end > duration + .1) throw new Error(`第 ${index + 1} 句超出了音视频时长`);
  });
}
export function parseSpeakingSubtitles(source: string): SpeakingCue[] {
  const text = source.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  const cues: SpeakingCue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const timeline = lines.findIndex(line => line.includes('-->'));
    if (timeline < 0) continue;
    const [startText, right] = lines[timeline].split('-->');
    const start = parseSubtitleTime(startText);
    const end = parseSubtitleTime(right.trim().split(/\s/)[0]);
    const clean = lines.slice(timeline + 1).map(line => line.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()).filter(Boolean);
    const en = clean.filter(line => !/[\u3400-\u9fff]/.test(line) && /[a-zA-Z]/.test(line)).join(' ');
    const zh = clean.filter(line => /[\u3400-\u9fff]/.test(line)).join(' ');
    cues.push({ id: `cue-${cues.length + 1}`, start, end, en, zh });
  }
  validateSpeakingCues(cues);
  return cues;
}

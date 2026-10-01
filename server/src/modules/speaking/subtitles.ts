import { createHash } from 'node:crypto';
import { SPEAKING_MAX_SUBTITLE_BYTES, SpeakingCuesSchema, type SpeakingCue } from '@context-reader/contracts';
import { AppError } from '../../core/errors';

export function validateSpeakingCues(cues: SpeakingCue[], duration: number): SpeakingCue[] {
  const parsed = SpeakingCuesSchema.safeParse(cues);
  if (!parsed.success) throw invalidSubtitles();
  if (parsed.data.some(cue => cue.end > duration + 0.1)) {
    throw new AppError('VALIDATION_ERROR', '字幕时间超出了媒体时长，请校正后重试', 422);
  }
  return parsed.data;
}

export function parseSpeakingSubtitles(source: string, format: 'srt' | 'vtt'): SpeakingCue[] {
  if (Buffer.byteLength(source, 'utf8') > SPEAKING_MAX_SUBTITLE_BYTES) {
    throw new AppError('IMPORT_TOO_LARGE', '字幕不能超过 512 KB', 413);
  }
  const text = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim();
  if (format === 'vtt' && !/^WEBVTT(?:\s|$)/u.test(text)) throw invalidSubtitles();
  const cues: SpeakingCue[] = [];
  for (const block of text.split(/\n[\t ]*\n/gu)) {
    const lines = block.split('\n');
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/u.test(lines[0] ?? '')) continue;
    const timeline = lines.findIndex(line => line.includes('-->'));
    if (timeline < 0) throw invalidSubtitles();
    const match = lines[timeline]?.match(/^\s*(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/u);
    if (!match) throw invalidSubtitles();
    const start = subtitleTime(match[1]!);
    const end = subtitleTime(match[2]!);
    const clean = lines.slice(timeline + 1).join('\n')
      .replace(/<br\s*\/?\s*>/giu, '\n').replace(/<[^>]*>/gu, '')
      .replace(/\{\\[^}]*\}/gu, '').replace(/&amp;/gu, '&')
      .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&nbsp;/gu, ' ')
      .split('\n').map(line => line.trim()).filter(Boolean);
    const en = clean.filter(line => /[A-Za-z]/u.test(line) && !/[\u3400-\u9fff]/u.test(line)).join(' ');
    const zh = clean.filter(line => /[\u3400-\u9fff]/u.test(line)).join(' ');
    // 只有音乐符号或非英文的 cue 不作为英文跟读句。
    if (!en) continue;
    const digest = createHash('sha256').update(`${start}|${end}|${en}`).digest('hex').slice(0, 20);
    cues.push({ id: `cue-${digest}`, start, end, en, zh });
  }
  const parsed = SpeakingCuesSchema.safeParse(cues);
  if (!parsed.success) throw invalidSubtitles();
  return parsed.data;
}

function subtitleTime(value: string): number {
  const match = value.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/u);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw invalidSubtitles();
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function invalidSubtitles() {
  return new AppError('IMPORT_PARSE_FAILED', '字幕格式无效，请检查 SRT／VTT 和英文时间轴', 422);
}

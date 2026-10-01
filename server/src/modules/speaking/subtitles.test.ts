import { describe, expect, it } from 'vitest';
import { parseSpeakingSubtitles, validateSpeakingCues } from './subtitles';

describe('真实字幕时间轴', () => {
  it('保留多行双语、显示标签和重叠对白的可练习文本', () => {
    const cues = parseSpeakingSubtitles('\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i><br>world &amp; friends.\r\n你好。\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\n{\\an8}Good morning!\r\n', 'srt');
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, en: 'Hello world & friends.', zh: '你好。' });
    expect(cues[1]?.en).toBe('Good morning!');
    expect(validateSpeakingCues(cues, 5)).toEqual(cues);
    expect(parseSpeakingSubtitles('1\n00:00:01,000 --> 00:00:03,500\nHello world &amp; friends.\n你好。', 'srt')[0]?.id).toBe(cues[0]?.id);
  });
  it('支持 VTT 句标识、位置设置与小时制时间', () => {
    const cues = parseSpeakingSubtitles('WEBVTT\n\nNOTE caption notes\nignored\n\nchapter-1\n01:02:03.040 --> 01:02:05.600 align:start\n<v Alex>We can try again.</v>', 'vtt');
    expect(cues[0]).toMatchObject({ start: 3723.04, end: 3725.6, en: 'We can try again.', zh: '' });
  });
  it.each([
    '', '1\n00:99:01,000 --> 00:99:02,000\nInvalid minute.',
    '1\n00:00:03,000 --> 00:00:01,000\nBackwards.',
    '1\n00:00:03,000 --> 00:00:04,000\nSecond.\n\n2\n00:00:01,000 --> 00:00:02,000\nFirst.',
    'invalid prose', '1\n00:00:00,000 --> 00:00:01,000\n♪',
  ])('拒绝损坏或没有英文对白的字幕', text => {
    expect(() => parseSpeakingSubtitles(text, 'srt')).toThrow(expect.objectContaining({ code: 'IMPORT_PARSE_FAILED' }));
  });
  it('按 UTF-8 字节限制字幕大小，并拒绝超过真实媒体时长的结束时间', () => {
    expect(() => parseSpeakingSubtitles('汉'.repeat(180_000), 'srt')).toThrow(expect.objectContaining({ code: 'IMPORT_TOO_LARGE' }));
    expect(() => validateSpeakingCues([{ id: 'one', start: 0, end: 6, en: 'Hello.', zh: '' }], 5))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

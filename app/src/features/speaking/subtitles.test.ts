import { parseSpeakingSubtitles, parseSubtitleTime, validateSpeakingCues } from './subtitles';

it('imports bilingual SRT with multiline English and millisecond timing', () => {
  const cues = parseSpeakingSubtitles('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nA small question\r\ncan open a conversation.\r\n一个小问题。\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,100\r\nBe curious.\r\n保持好奇。');
  expect(cues).toHaveLength(2);
  expect(cues[0]).toMatchObject({ start: 1.25, end: 3.5, en: 'A small question can open a conversation.', zh: '一个小问题。' });
});
it('imports VTT cue identifiers, settings and tags while ignoring notes', () => {
  const cues = parseSpeakingSubtitles('WEBVTT\n\nNOTE private note\nignore\n\nfirst\n00:01.000 --> 00:03.000 align:start\n<v Speaker>Hello &amp; welcome.</v>');
  expect(cues[0]).toMatchObject({ start: 1, end: 3, en: 'Hello & welcome.' });
});
it('allows overlapping movie dialogue but rejects unsorted starts and out-of-media times', () => {
  expect(() => parseSpeakingSubtitles('1\n00:00:00,000 --> 00:00:01,000\n只有中文')).toThrow('英文');
  expect(() => parseSubtitleTime('00:61:00')).toThrow('时间格式');
  expect(() => parseSubtitleTime('NaN')).toThrow('时间格式');
  const cues = [{ id: '1', start: 0, end: 3, en: 'Hello.', zh: '' }, { id: '2', start: 2, end: 5, en: 'World.', zh: '' }];
  expect(() => validateSpeakingCues(cues)).not.toThrow();
  expect(() => validateSpeakingCues([...cues].reverse())).toThrow('排序');
  expect(() => validateSpeakingCues([cues[0]], 2)).toThrow('超出');
});

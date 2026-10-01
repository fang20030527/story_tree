import { decodeSpeakingSubtitle } from './subtitleEncoding';
import { parseSpeakingSubtitles } from './subtitles';

it('decodes UTF-8 bilingual subtitles without damaging Chinese', () => {
  const text = '1\n00:00:01,000 --> 00:00:03,000\nHello!\n你好！';
  expect(decodeSpeakingSubtitle(new TextEncoder().encode(text))).toBe(text);
});
it('decodes Windows-1252 film dialogue and punctuation instead of replacement characters', () => {
  const before = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:03,000\nIt');
  const after = new TextEncoder().encode('s a caf');
  const bytes = new Uint8Array([...before, 0x92, ...after, 0xe9, 0x2e]);
  const decoded = decodeSpeakingSubtitle(bytes);
  expect(decoded).toContain('It’s a café.');
  expect(decoded).not.toContain('\uFFFD');
  expect(parseSpeakingSubtitles(decoded)[0]?.en).toBe('It’s a café.');
});

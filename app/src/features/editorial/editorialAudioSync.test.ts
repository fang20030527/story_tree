import { getEditorialArticle } from './catalog';
import { findAudioCue, type EditorialAudioCue } from './editorialAudioSync';
import { tokenizeArticleText } from '@/features/practice/ArticleParagraph';

it('tracks boundaries, backwards seeking, intro and outro', () => {
  const cues: EditorialAudioCue[] = [[0, 0, 3, 2, 3], [0, 4, 9, 3.5, 4.5], [1, 0, 4, 5, 6]];
  expect(findAudioCue(cues, 0)).toBeUndefined();
  expect(findAudioCue(cues, 3.2)).toBe(cues[0]);
  expect(findAudioCue(cues, 3.5)).toBe(cues[1]);
  expect(findAudioCue(cues, 5.5)).toBe(cues[2]);
  expect(findAudioCue(cues, 2.5)).toBe(cues[0]);
  expect(findAudioCue(cues, 6)).toBeUndefined();
  expect(findAudioCue(cues, NaN)).toBeUndefined();
  expect(findAudioCue([], 10)).toBeUndefined();
});

it('covers each spoken word in the bundled article with ordered, valid recording timestamps', () => {
  const article = getEditorialArticle('ai-arms-race')!;
  const cues = article.audioCues!;
  let previousStart = -1;
  for (const [paragraph, start, end, time, finish] of cues) {
    expect(time).toBeGreaterThan(previousStart);
    expect(finish).toBeGreaterThanOrEqual(time);
    expect(finish).toBeLessThanOrEqual(436.605);
    expect(article.paragraphs[paragraph]!.slice(start, end)).toMatch(/^[A-Za-z]+(?:['’][A-Za-z]+|-[A-Za-z]+)*$/u);
    previousStart = time;
  }
  article.paragraphs.forEach((paragraph, index) => {
    // 原始录音跳过此小标题。
    if (paragraph === 'Effective doomerism') return;
    expect(cues.filter((cue) => cue[0] === index).map((cue) => paragraph.slice(cue[1], cue[2])))
      .toEqual(tokenizeArticleText(paragraph).filter((token) => token.isWord).map((token) => token.text));
  });
  expect(findAudioCue(cues, 14)).toBeUndefined();
});

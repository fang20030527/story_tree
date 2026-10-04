import { describe, expect, it } from 'vitest';

import {
  countEnglishWords,
  sentenceContaining,
  splitSentences,
  targetGapGuidance,
} from './article-metrics';

describe('word counting', () => {
  it('counts hyphenated words and contractions once and ignores numbers and punctuation', () => {
    expect(countEnglishWords("A well-known writer didn't say 42 things — or did she?")).toBe(9);
  });
});

describe('sentence splitting', () => {
  it('splits on sentence punctuation followed by a capital letter', () => {
    expect(splitSentences('It rained. The streets flooded! Did anyone notice? Few did.')).toEqual([
      'It rained.', 'The streets flooded!', 'Did anyone notice?', 'Few did.',
    ]);
  });

  it('does not split after abbreviations, initials or when the next word is lower case', () => {
    expect(splitSentences('Dr. Rivera met J. Smith in the U.S. last year, e.g. at a conference. They talked.')).toEqual([
      'Dr. Rivera met J. Smith in the U.S. last year, e.g. at a conference.', 'They talked.',
    ]);
    expect(splitSentences('The ratio rose to 3.5 percent. Then it fell.')).toEqual(['The ratio rose to 3.5 percent.', 'Then it fell.']);
  });

  it('keeps closing quotes with their sentence and returns text without punctuation as one sentence', () => {
    expect(splitSentences('She said, "We can stop." Nobody moved.')).toEqual(['She said, "We can stop."', 'Nobody moved.']);
    expect(splitSentences('no punctuation at all')).toEqual(['no punctuation at all']);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('finds the sentence that contains an offset', () => {
    const text = 'First sentence here. The target word sits in the second one. Third.';
    expect(sentenceContaining(text, text.indexOf('target'))).toBe('The target word sits in the second one.');
    expect(sentenceContaining(text, 9999)).toBeNull();
  });
});

describe('target gap guidance', () => {
  it('asks the writer for denser placement as targets increase, never below 35 words', () => {
    expect([1, 2, 6, 8, 10, 12].map((count) => targetGapGuidance(count, 'short'))).toEqual([173, 115, 50, 39, 35, 35]);
    expect(targetGapGuidance(6, 'long')).toBe(203);
  });
});

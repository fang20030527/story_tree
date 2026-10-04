import { describe, expect, it } from 'vitest';

import { coerceGeneratedPractice } from './coerce';
import { GeneratedPracticeSchema } from './generated-schemas';

const question = {
  targetAlias: 't1', prompt: 'A ____ plan.', optionsEn: ['a', 'b', 'c', 'd'], correctOptionIndex: 1,
  meaningEn: 'm', explanationZh: '解释', optionExplanationsZh: ['一', '二', '三', '四'], optionExplanationsEn: ['a', 'b', 'c', 'd'],
};
const strict = {
  title: 'T',
  paragraphs: [{ key: 'p1', text: 'One.' }, { key: 'p2', text: 'Two.' }, { key: 'p3', text: 'Three.' }],
  usages: [{ targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'One' }],
  questions: [question],
};

describe('generated practice shape repair', () => {
  it('leaves a well-formed reply unchanged', () => {
    expect(coerceGeneratedPractice(structuredClone(strict))).toEqual(strict);
  });

  it('unwraps a reply nested under a wrapper key', () => {
    for (const wrapper of ['practice', 'artifact', 'result', 'data', 'somethingElse']) {
      expect(GeneratedPracticeSchema.parse(coerceGeneratedPractice({ [wrapper]: structuredClone(strict) }))).toEqual(strict);
    }
  });

  it('turns paragraph strings and objects keyed by paragraph key, alias or option letter into arrays', () => {
    const repaired = GeneratedPracticeSchema.parse(coerceGeneratedPractice({
      title: 'T',
      paragraphs: { p10: 'Ten.', p2: 'Two.', p1: 'One.' },
      usages: { t1: { paragraphKey: 'p1', surfaceForm: 'One' } },
      questions: { t1: { ...question, targetAlias: undefined, optionsEn: { b: 'two', a: 'one', c: 'three', d: 'four' } } },
    }));
    expect(repaired.paragraphs.map((paragraph) => paragraph.key)).toEqual(['p1', 'p2', 'p10']);
    expect(repaired.usages).toEqual([{ targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'One' }]);
    expect(repaired.questions[0]).toMatchObject({ targetAlias: 't1', optionsEn: ['one', 'two', 'three', 'four'] });
    expect(GeneratedPracticeSchema.parse(coerceGeneratedPractice({ ...strict, paragraphs: ['One.', 'Two.', 'Three.'] })).paragraphs)
      .toEqual(strict.paragraphs);
  });

  it('renames synonym keys, drops extra keys and reads the answer index from text', () => {
    const repaired = GeneratedPracticeSchema.parse(coerceGeneratedPractice({
      ...strict,
      wordCount: 250,
      notes: 'ignored',
      usages: [{ alias: 't1', paragraph: 'p1', surface: 'One', confidence: 0.9 }],
      questions: [{ alias: 't1', question: 'A ____ plan.', options: ['a', 'b', 'c', 'd'], correctIndex: 'C', meaningEn: 'm',
        explanationZh: '解释', optionExplanationsZh: ['一', '二', '三', '四'], optionExplanationsEn: ['a', 'b', 'c', 'd'], difficulty: 'easy' }],
    }));
    expect(repaired.usages[0]).toEqual({ targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'One' });
    expect(repaired.questions[0]).toMatchObject({ targetAlias: 't1', prompt: 'A ____ plan.', correctOptionIndex: 2 });
    expect(coerceGeneratedPractice({ ...strict, questions: [{ ...question, correctOptionIndex: '3' }] }).questions).toMatchObject([{ correctOptionIndex: 3 }]);
  });

  it('fills neutral defaults for whatever is missing, without inventing content', () => {
    const repaired = GeneratedPracticeSchema.parse(coerceGeneratedPractice({
      paragraphs: ['One.', { text: 'Two.' }, { key: 'x' }, 7, null],
      questions: [{ alias: 't2' }, 'junk', { alias: 't3', options: 'not a list', correctOptionIndex: 'maybe', optionExplanationsZh: [1, 'b'] }],
    }));
    expect(repaired.title).toBe('');
    expect(repaired.paragraphs).toEqual([{ key: 'p1', text: 'One.' }, { key: 'p2', text: 'Two.' }, { key: 'x', text: '' }]);
    expect(repaired.usages).toEqual([]);
    expect(repaired.questions).toEqual([
      { targetAlias: 't2', prompt: '', optionsEn: [], correctOptionIndex: -1, meaningEn: '', explanationZh: '', optionExplanationsZh: [], optionExplanationsEn: [] },
      { targetAlias: 't3', prompt: '', optionsEn: [], correctOptionIndex: -1, meaningEn: '', explanationZh: '', optionExplanationsZh: ['1', 'b'], optionExplanationsEn: [] },
    ]);
  });

  it('keeps wrong-sized option lists and bad indexes as they are for the validator to repair', () => {
    const repaired = GeneratedPracticeSchema.parse(coerceGeneratedPractice({
      ...strict,
      questions: [{ ...question, optionsEn: ['only'], correctOptionIndex: 9, optionExplanationsZh: [] }],
    }));
    expect(repaired.questions[0]).toMatchObject({ optionsEn: ['only'], correctOptionIndex: 9, optionExplanationsZh: [] });
  });

  it('still refuses a reply without any article, so it is read as unusable', () => {
    expect(GeneratedPracticeSchema.safeParse(coerceGeneratedPractice({ title: 'T' })).success).toBe(false);
    expect(GeneratedPracticeSchema.safeParse(coerceGeneratedPractice({ ...strict, paragraphs: 'One. Two. Three.' })).success).toBe(false);
    expect(GeneratedPracticeSchema.safeParse(coerceGeneratedPractice({ ...strict, paragraphs: [] })).success).toBe(false);
    expect(GeneratedPracticeSchema.safeParse(coerceGeneratedPractice({ ...strict, paragraphs: [7, null] })).success).toBe(false);
    // Missing usages become an empty list so the validator can find each target in the article.
    expect(coerceGeneratedPractice({ ...strict, usages: undefined }).usages).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { generationMessages } from '../../infrastructure/ai/prompts';

import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import {
  PracticeValidationError,
  segmentParagraph,
  validateGeneratedPractice,
  type GenerationTarget,
} from './generation-validator';

// No vocabulary term is known here, so a target is found only where the model said it is.
const target: GenerationTarget = {
  id: crypto.randomUUID(),
  alias: 't1',
  meaningZh: '有韧性的',
};

describe('generated practice validation', () => {
  it('accepts the deterministic fake article for topic and long formats and records an out-of-range length', async () => {
    const input = { examPath: 'ielts' as const, topic: '科技' as const, targets: [{ alias: 't1', term: 'resilient', meaningZh: target.meaningZh }] };
    const generated = await new FakeAiProvider().generatePractice(input, new AbortController().signal);
    const short = validateGeneratedPractice(generated, [target], 'short');
    expect(short.wordCount).toBe(250);
    expect(short.notes).toBeUndefined();
    // The same article is too short for the long format; it is stored and the length is noted.
    expect(validateGeneratedPractice(generated, [target]).notes).toEqual(['WORD_COUNT_LOW:250']);
    expect(generationMessages(input)[0]!.content).toContain('200-300');
    expect(generationMessages(input)[0]!.content).toContain('科技');
    for (const count of [199, 301]) {
      const altered = structuredClone(generated);
      altered.paragraphs = [
        { key: 'p1', text: `resilient ${'study '.repeat(count - 3)}` },
        { key: 'p2', text: 'study' }, { key: 'p3', text: 'study' },
      ];
      const result = validateGeneratedPractice(altered, [target], 'short');
      expect(result.wordCount).toBe(count);
      expect(result.notes).toEqual([`WORD_COUNT_${count < 200 ? 'LOW' : 'HIGH'}:${count}`]);
    }
  });

  it('maps exact target usages and supplied meanings into safe persistence data', () => {
    const generated = validGeneratedPractice();

    const result = validateGeneratedPractice(generated, [target]);

    expect(result.wordCount).toBeGreaterThanOrEqual(700);
    expect(result.wordCount).toBeLessThanOrEqual(1_000);
    expect(result.notes).toBeUndefined();
    expect(result.usages).toEqual([
      expect.objectContaining({
        targetId: target.id,
        paragraphKey: 'p1',
        surfaceForm: 'resilient',
        startOffset: expect.any(Number),
        endOffset: expect.any(Number),
      }),
    ]);
    expect(result.questions).toEqual([
      expect.objectContaining({ targetId: target.id, correctOptionIndex: 1 }),
    ]);
  });

  it.each([
    ['no paragraphs', (value: GeneratedPractice) => { value.paragraphs = []; }, 'ARTICLE_EMPTY'],
    ['empty paragraphs', (value: GeneratedPractice) => { value.paragraphs.forEach((paragraph) => { paragraph.text = '  '; }); }, 'ARTICLE_EMPTY'],
    ['an article of a few words', (value: GeneratedPractice) => { value.paragraphs = [{ key: 'p1', text: 'resilient only' }]; }, 'ARTICLE_EMPTY'],
    ['an article in Chinese', (value: GeneratedPractice) => { value.paragraphs = [{ key: 'p1', text: '这是一篇完全用中文写成的文章，里面没有英文内容。'.repeat(20) }]; }, 'ARTICLE_LANGUAGE'],
    ['a usage that is missing', (value: GeneratedPractice) => { value.usages.splice(0, 1); }, 'TARGET_MISSING'],
    ['a reply without any question', (value: GeneratedPractice) => { value.questions = []; }, 'QUESTIONS_MISSING'],
    ['a surface form that is not in the article', (value: GeneratedPractice) => { value.usages[0]!.surfaceForm = 'absent'; }, 'TARGET_MISSING'],
  ])('rejects %s', (_name, mutate, code) => {
    const generated = validGeneratedPractice();
    mutate(generated);
    expect(() => validateGeneratedPractice(generated, [target])).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT', retryable: true, issueCodes: [code] }),
    );
  });

  it('treats a fragment of a longer word as a place in the article rather than rejecting the target', () => {
    const generated = validGeneratedPractice();
    generated.usages[0]!.surfaceForm = 'silient';
    expect(validateGeneratedPractice(generated, [target]).usages[0]!.surfaceForm).toBe('silient');
  });

  it.each([
    ['duplicate usage alias', (value: GeneratedPractice) => value.usages.push({ ...value.usages[0]!, paragraphKey: 'p3' })],
    ['duplicate question alias', (value: GeneratedPractice) => value.questions.push({ ...value.questions[0]!, prompt: 'A later ____.' })],
    ['duplicate options', (value: GeneratedPractice) => { value.questions[0]!.optionsEn[2] = value.questions[0]!.optionsEn[1]!; }],
    ['Chinese option', (value: GeneratedPractice) => { value.questions[0]!.optionsEn[0] = '并非给定义项'; }],
    ['Chinese prompt', (value: GeneratedPractice) => { value.questions[0]!.prompt = '选择 ____。'; }],
    ['English summary', (value: GeneratedPractice) => { value.questions[0]!.explanationZh = 'This is correct.'; }],
    ['English option explanation in the Chinese list', (value: GeneratedPractice) => { value.questions[0]!.optionExplanationsZh[0] = 'English only.'; }],
    ['missing blank', (value: GeneratedPractice) => { value.questions[0]!.prompt = 'Which word fits?'; }],
    ['multiple blanks', (value: GeneratedPractice) => { value.questions[0]!.prompt = 'The ____ team remained ____.'; }],
    ['answer leaked in prompt', (value: GeneratedPractice) => { value.questions[0]!.prompt = 'A resilient team is ____.'; }],
    ['case-insensitive duplicate', (value: GeneratedPractice) => { value.questions[0]!.optionsEn[0] = ' RESILIENT '; }],
    ['copied article sentence', (value: GeneratedPractice) => {
      value.paragraphs[0]!.text = value.paragraphs[0]!.text.replace('resilient', 'Despite repeated setbacks, the team remained resilient and quickly recovered.');
    }],
    ['too few words', (value: GeneratedPractice) => {
      value.paragraphs[0]!.text = `resilient ${'study '.repeat(200)}`;
      value.paragraphs[1]!.text = 'study '.repeat(200);
      value.paragraphs[2]!.text = 'study '.repeat(200);
    }],
    ['too many words', (value: GeneratedPractice) => {
      value.paragraphs[0]!.text = `resilient ${'study '.repeat(334)}`;
      value.paragraphs[1]!.text = 'study '.repeat(334);
      value.paragraphs[2]!.text = 'study '.repeat(334);
    }],
    ['repeated surface form', (value: GeneratedPractice) => { value.paragraphs[0]!.text += ' resilient'; }],
  ])('lets %s through', (_name, mutate) => {
    const generated = validGeneratedPractice();
    mutate(generated);

    const result = validateGeneratedPractice(generated, [target]);

    expect(result.usages).toHaveLength(1);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.optionsEn).toHaveLength(4);
  });

  it.each([
    ['an invalid answer index', (value: GeneratedPractice) => { value.questions[0]!.correctOptionIndex = 4; }, undefined],
    ['a fractional answer index', (value: GeneratedPractice) => { value.questions[0]!.correctOptionIndex = 1.5; }, undefined],
    ['an answer index that points elsewhere', (value: GeneratedPractice) => { value.questions[0]!.correctOptionIndex = 3; }, 'ANSWER_FROM_TARGET:t1'],
  ])('repairs %s so that the answer is the target word', (_name, mutate, note) => {
    const generated = validGeneratedPractice();
    mutate(generated);

    const result = validateGeneratedPractice(generated, [target]);

    const [question] = result.questions;
    expect(question!.optionsEn).toHaveLength(4);
    expect(question!.optionsEn[question!.correctOptionIndex]).toBe('resilient');
    if (note) expect(result.notes).toContain(note);
  });

  it('builds the question from the article when the reply has none and the draft is the final one', () => {
    const generated = validGeneratedPractice();
    generated.questions = [];

    const result = validateGeneratedPractice(generated, [target], 'long', { completeMissing: true });

    expect(result.notes).toEqual(['QUESTION_BUILT:t1']);
    expect(result.questions[0]!.optionsEn[result.questions[0]!.correctOptionIndex]).toBe('resilient');
    expect(result.questions[0]!.optionsEn).toHaveLength(4);
  });

  it('only ever raises the retryable structural error with the problems named for the rewrite', () => {
    const generated = validGeneratedPractice();
    generated.usages = [];
    try {
      validateGeneratedPractice(generated, [target]);
      throw new Error('Expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PracticeValidationError);
      expect((error as PracticeValidationError).repairIssue).toContain('These targets do not appear in the article: t1');
      expect((error as PracticeValidationError).repairIssues).toEqual([(error as PracticeValidationError).repairIssue]);
    }
  });
});

describe('paragraph segmentation', () => {
  it('returns ordered plain and target text without HTML interpretation', () => {
    expect(
      segmentParagraph('<b>A resilient idea</b>', [
        { id: target.id, startOffset: 5, endOffset: 14 },
      ]),
    ).toEqual([
      { text: '<b>A ', targetId: null },
      { text: 'resilient', targetId: target.id },
      { text: ' idea</b>', targetId: null },
    ]);
  });
});

function validGeneratedPractice(): GeneratedPractice {
  return {
    title: 'A Study of Adaptation',
    paragraphs: [
      { key: 'p1', text: `${'study '.repeat(239)}resilient` },
      { key: 'p2', text: 'evidence '.repeat(235).trim() },
      { key: 'p3', text: 'reflection '.repeat(235).trim() },
    ],
    usages: [
      { targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'resilient' },
    ],
    questions: [
      {
        targetAlias: 't1',
        prompt: 'Despite repeated setbacks, the team remained ____ and quickly recovered.',
        optionsEn: ['fragile', 'resilient', 'temporary', 'ambiguous'],
        correctOptionIndex: 1,
        meaningEn: 'able to recover',
        explanationZh: '从挫折中恢复的能力体现了韧性。',
        optionExplanationsZh: ['表示脆弱。', '符合恢复能力。', '描述持续时间。', '描述不确定性。'],
        optionExplanationsEn: ['Suggests weakness.', 'Fits recovery.', 'Describes duration.', 'Describes uncertainty.'],
      },
    ],
  };
}

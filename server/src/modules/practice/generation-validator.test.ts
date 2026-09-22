import { describe, expect, it } from 'vitest';

import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { generationMessages, verificationMessages } from '../../infrastructure/ai/prompts';

import type { GeneratedPractice } from '../../infrastructure/ai/generated-schemas';
import {
  segmentParagraph,
  validateGeneratedPractice,
  type GenerationTarget,
} from './generation-validator';

const target: GenerationTarget = {
  id: crypto.randomUUID(),
  alias: 't1',
  meaningZh: '有韧性的',
};

describe('generated practice validation', () => {
  it('enforces 200–300 words for topic articles and retains legacy long validation', async () => {
    const input = { examPath: 'ielts' as const, topic: '科技' as const, targets: [{ alias: 't1', term: 'resilient', meaningZh: target.meaningZh }] };
    const generated = await new FakeAiProvider().generatePractice(input, new AbortController().signal);
    expect(validateGeneratedPractice(generated, [target], 'short').wordCount).toBe(250);
    expect(() => validateGeneratedPractice(generated, [target])).toThrow();
    expect(generationMessages(input)[0]!.content).toContain('200-300');
    expect(generationMessages(input)[0]!.content).toContain('科技');
    expect(verificationMessages({ ...input, generated })[0]!.content).toContain('科技');
    for (const count of [199, 301]) {
      const altered = structuredClone(generated);
      altered.paragraphs = [
        { key: 'p1', text: `resilient ${'study '.repeat(count - 3)}` },
        { key: 'p2', text: 'study' }, { key: 'p3', text: 'study' },
      ];
      expect(() => validateGeneratedPractice(altered, [target], 'short')).toThrow();
    }
  });

  it('maps exact target usages and supplied meanings into safe persistence data', () => {
    const generated = validGeneratedPractice();

    const result = validateGeneratedPractice(generated, [target]);

    expect(result.wordCount).toBeGreaterThanOrEqual(700);
    expect(result.wordCount).toBeLessThanOrEqual(1_000);
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
    ['missing usage alias', (value: GeneratedPractice) => value.usages.splice(0, 1)],
    ['duplicate usage alias', (value: GeneratedPractice) => value.usages.push(value.usages[0]!)],
    ['missing question alias', (value: GeneratedPractice) => value.questions.splice(0, 1)],
    ['duplicate question alias', (value: GeneratedPractice) => value.questions.push(value.questions[0]!)],
    ['duplicate options', (value: GeneratedPractice) => {
      value.questions[0]!.optionsEn[2] = value.questions[0]!.optionsEn[1]!;
    }],
    ['Chinese option', (value: GeneratedPractice) => {
      value.questions[0]!.optionsEn[1] = '并非给定义项';
    }],
    ['Chinese prompt', (value: GeneratedPractice) => { value.questions[0]!.prompt = '选择 ____。'; }],
    ['English summary', (value: GeneratedPractice) => { value.questions[0]!.explanationZh = 'This is correct.'; }],
    ['Missing Chinese option explanation', (value: GeneratedPractice) => { value.questions[0]!.optionExplanationsZh[0] = 'English only.'; }],
    ['missing blank', (value: GeneratedPractice) => { value.questions[0]!.prompt = 'Which word fits?'; }],
    ['multiple blanks', (value: GeneratedPractice) => { value.questions[0]!.prompt = 'The ____ team remained ____.'; }],
    ['invalid answer index', (value: GeneratedPractice) => { value.questions[0]!.correctOptionIndex = 4; }],
    ['fractional answer index', (value: GeneratedPractice) => { value.questions[0]!.correctOptionIndex = 1.5; }],
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
    ['missing surface form', (value: GeneratedPractice) => {
      value.usages[0]!.surfaceForm = 'absent';
    }],
    ['repeated surface form', (value: GeneratedPractice) => {
      value.paragraphs[0]!.text += ' resilient';
    }],
  ])('rejects %s', (_name, mutate) => {
    const generated = validGeneratedPractice();
    mutate(generated);

    expect(() => validateGeneratedPractice(generated, [target])).toThrowError(
      expect.objectContaining({ code: 'AI_INVALID_OUTPUT', retryable: true }),
    );
  });

  it('rejects target ranges that overlap through different declared surfaces', () => {
    const secondTarget: GenerationTarget = {
      id: crypto.randomUUID(),
      alias: 't2',
      meaningZh: '局部词形',
    };
    const generated = validGeneratedPractice();
    generated.usages.push({
      targetAlias: 't2',
      paragraphKey: 'p1',
      surfaceForm: 'silient',
    });
    generated.questions.push({
      targetAlias: 't2',
      prompt: 'What does the partial form mean?',
      optionsEn: ['fragile', 'silient', 'temporary', 'ambiguous'],
      correctOptionIndex: 1,
      meaningEn: 'a partial surface',
      explanationZh: '测试重叠范围。',
      optionExplanationsZh: ['不符合。', '符合。', '不符合。', '不符合。'],
      optionExplanationsEn: ['不符合。', '符合。', '不符合。', '不符合。'],
    });

    expect(() =>
      validateGeneratedPractice(generated, [target, secondTarget]),
    ).toThrowError(expect.objectContaining({ code: 'AI_INVALID_OUTPUT' }));
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

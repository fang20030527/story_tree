import { describe, expect, it } from 'vitest';

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
      value.questions[0]!.optionsZh[2] = value.questions[0]!.optionsZh[1]!;
    }],
    ['missing supplied meaning', (value: GeneratedPractice) => {
      value.questions[0]!.optionsZh[1] = '并非给定义项';
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
      optionsZh: ['无关甲', '局部词形', '无关乙', '无关丙'],
      meaningEn: 'a partial surface',
      explanationZh: '测试重叠范围。',
      optionExplanationsZh: ['不符合。', '符合。', '不符合。', '不符合。'],
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
        prompt: 'What does resilient mean here?',
        optionsZh: ['脆弱的', '有韧性的', '短暂的', '含糊的'],
        meaningEn: 'able to recover',
        explanationZh: '上下文强调恢复能力。',
        optionExplanationsZh: ['相反含义。', '符合语境。', '无关含义。', '无关含义。'],
      },
    ],
  };
}

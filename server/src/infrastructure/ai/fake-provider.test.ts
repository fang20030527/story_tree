import { describe, expect, it } from 'vitest';

import { FakeAiProvider } from './fake-provider';
import type { GeneratePracticeInput } from './types';

const input: GeneratePracticeInput = {
  examPath: 'ielts',
  targets: [
    { alias: 't1', term: 'resilient', meaningZh: '有韧性的' },
    { alias: 't2', term: 'ambiguous', meaningZh: '模棱两可的' },
    { alias: 't3', term: 'meticulous', meaningZh: '一丝不苟的' },
  ],
};

describe('Fake AI provider', () => {
  it('generates a deterministic valid IELTS artifact for every target', async () => {
    const provider = new FakeAiProvider();
    const signal = new AbortController().signal;

    const first = await provider.generatePractice(input, signal);
    const second = await provider.generatePractice(input, signal);
    const wordCount = first.paragraphs
      .map((paragraph) => paragraph.text)
      .join(' ')
      .trim()
      .split(/\s+/u).length;

    expect(second).toEqual(first);
    expect(first.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(wordCount).toBeGreaterThanOrEqual(700);
    expect(wordCount).toBeLessThanOrEqual(1_000);

    for (const target of input.targets) {
      expect(first.usages.filter((usage) => usage.targetAlias === target.alias)).toHaveLength(1);
      const questions = first.questions.filter(
        (question) => question.targetAlias === target.alias,
      );
      expect(questions).toHaveLength(1);
      expect(questions[0]?.optionsEn).toHaveLength(4);
      expect(new Set(questions[0]?.optionsEn).size).toBe(4);
      expect(questions[0]?.optionsEn).toContain(target.term);
    }
  });

  it('returns deterministic verification, translation, and moderation results', async () => {
    const provider = new FakeAiProvider();
    const signal = new AbortController().signal;
    const generated = await provider.generatePractice(input, signal);

    await expect(
      provider.verifyPractice({ ...input, generated }, signal),
    ).resolves.toEqual({ approved: true, issues: [] });
    await expect(provider.translate('Source text.', signal)).resolves.toBe(
      '译文：这是供测试使用的中文内容。',
    );
    await expect(provider.moderate('Safe text.', signal)).resolves.toEqual({
      riskLevel: 'low',
      flagged: false,
    });
    await expect(
      provider.extractArticleText(
        [
          { position: 0, mediaType: 'image/jpeg', base64: 'dGVzdA==' },
          { position: 1, mediaType: 'image/png', base64: 'dGVzdA==' },
        ],
        signal,
      ),
    ).resolves.toMatchObject({
      title: 'Synthetic imported article',
      text: expect.stringMatching(/position 0[\s\S]+position 1/iu),
    });
  });

  it('does not impose the former two-digit target alias ceiling', async () => {
    const manyTargets: GeneratePracticeInput = {
      examPath: 'ielts',
      targets: Array.from({ length: 100 }, (_, index) => ({
        alias: `t${index + 1}`,
        term: `term-${index + 1}`,
        meaningZh: `义项 ${index + 1}`,
      })),
    };

    const generated = await new FakeAiProvider().generatePractice(
      manyTargets,
      new AbortController().signal,
    );

    expect(generated.usages.at(-1)?.targetAlias).toBe('t100');
    expect(generated.questions).toHaveLength(100);
  });
});

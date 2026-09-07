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
      expect(questions[0]?.optionsZh).toHaveLength(4);
      expect(new Set(questions[0]?.optionsZh).size).toBe(4);
      expect(questions[0]?.optionsZh).toContain(target.meaningZh);
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
      '译文：Source text.',
    );
    await expect(provider.moderate('Safe text.', signal)).resolves.toEqual({
      riskLevel: 'low',
      flagged: false,
    });
  });
});

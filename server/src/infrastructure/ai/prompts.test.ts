import { describe, expect, it } from 'vitest';

import { generationMessages } from './prompts';
import type { GeneratePracticeInput } from './types';

const base: GeneratePracticeInput = {
  examPath: 'ielts',
  topic: '科技',
  targets: [
    { alias: 't1', term: 'resilient', meaningZh: '有韧性的' },
    { alias: 't2', term: 'scarce', meaningZh: '稀缺的' },
  ],
};
const planned: GeneratePracticeInput = {
  ...base,
  targets: base.targets.map((target) => ({ ...target, questionCount: 3 })),
};

const system = (input: GeneratePracticeInput) => generationMessages(input)[0]!.content as string;

describe('generation prompt question plan', () => {
  it('asks for one question per target when no plan is given', () => {
    const prompt = system(base);
    expect(prompt).toContain('Create exactly one English-only contextual fill-in-the-blank question per target.');
    expect(prompt).toContain('Repeat one usage and one question object per target');
    expect(prompt).not.toContain('Question plan');
    // One example question in the template.
    expect(prompt.match(/"targetAlias":"t1","prompt"/gu)).toHaveLength(1);
  });

  it('treats a plan of one question per target the same as no plan', () => {
    const ones: GeneratePracticeInput = { ...base, targets: base.targets.map((target) => ({ ...target, questionCount: 1 })) };
    expect(system(ones)).toBe(system(base));
  });

  it('lists how many questions every target gets and asks for different ones', () => {
    const prompt = system(planned);
    expect(prompt).toContain('Question plan (6 questions in total');
    expect(prompt).toContain('t1 x3, t2 x3');
    expect(prompt).toContain('make them clearly different');
    expect(prompt).toContain('one question object per planned question');
    expect(prompt).not.toContain('Create exactly one English-only contextual fill-in-the-blank question per target.');
    // The template shows a repeated alias so that it reads as valid.
    expect(prompt.match(/"targetAlias":"t1","prompt"/gu)).toHaveLength(2);
    // The blank and answer rules still apply to every question.
    expect(prompt).toContain('exactly one blank written as four underscores');
  });

  it('plans a mixed set of counts and passes the count to the model with each target', () => {
    const mixed: GeneratePracticeInput = {
      ...base,
      targets: [{ ...base.targets[0]!, questionCount: 2 }, base.targets[1]!],
    };
    expect(system(mixed)).toContain('Question plan (3 questions in total');
    expect(system(mixed)).toContain('t1 x2, t2 x1');
    const user = JSON.parse(generationMessages(mixed)[1]!.content as string) as { targets: Array<Record<string, unknown>> };
    expect(user.targets.map((target) => target.questionCount)).toEqual([2, undefined]);
  });
});

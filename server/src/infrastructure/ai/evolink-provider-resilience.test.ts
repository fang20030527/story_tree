import { describe, expect, it, vi } from 'vitest';

import { EvolinkClient, type EvolinkClientConfig } from './evolink-client';
import { EvolinkAiProvider } from './evolink-provider';
import * as prompts from './prompts';
import type { GeneratePracticeInput } from './types';
import { generationMessages } from './prompts';

const config: EvolinkClientConfig = {
  apiKey: 'test-secret-api-key',
  baseUrl: 'https://example.invalid/v1',
  textModel: 'test-text-model',
  timeoutMs: 1_000,
};

const practice = {
  title: 'Learning to Live Together',
  paragraphs: [{ key: 'p1', text: 'We must govern wisely.' }, { key: 'p2', text: 'Two.' }, { key: 'p3', text: 'Three.' }],
  usages: [{ targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'govern' }],
  questions: [{
    targetAlias: 't1', prompt: 'Leaders must ____ fairly.', optionsEn: ['govern', 'forget', 'hide', 'sleep'], correctOptionIndex: 0,
    meaningEn: 'to rule', explanationZh: '“治理”符合句意。', optionExplanationsZh: ['对', '错', '错', '错'],
    optionExplanationsEn: ['Fits.', 'No.', 'No.', 'No.'],
  }],
};
const input: GeneratePracticeInput = {
  examPath: 'ielts', topic: '政治', targets: [{ alias: 't1', term: 'govern', meaningZh: '治理' }],
};

function reply(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function providerFor(replies: string[], vision: Partial<ConstructorParameters<typeof EvolinkAiProvider>[1]> = {}) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const content of replies) fetchImpl.mockResolvedValueOnce(reply(content));
  const client = new EvolinkClient(config, fetchImpl);
  const generateText = vi.spyOn(client, 'generateText');
  return { provider: new EvolinkAiProvider(client, { visionModel: 'v', visionTimeoutMs: 1, ...vision }), fetchImpl, generateText };
}

const signal = new AbortController().signal;

describe('generation replies with formatting slips', () => {
  it('accepts wrappers, objects instead of arrays, synonym keys and extra keys without a second request', async () => {
    const messy = JSON.stringify({
      result: {
        title: practice.title,
        wordCount: 250,
        paragraphs: { p1: 'We must govern wisely.', p2: 'Two.', p3: 'Three.' },
        usages: { t1: { paragraph: 'p1', surface: 'govern' } },
        questions: [{ alias: 't1', question: practice.questions[0]!.prompt, options: practice.questions[0]!.optionsEn, correctIndex: '0',
          meaningEn: 'to rule', explanationZh: '“治理”符合句意。', optionExplanationsZh: ['对', '错', '错', '错'],
          optionExplanationsEn: ['Fits.', 'No.', 'No.', 'No.'], difficulty: 'easy' }],
      },
    });
    const { provider, fetchImpl } = providerFor([messy]);
    await expect(provider.generatePractice(input, signal)).resolves.toEqual(practice);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts a reply that only has an article, leaving the missing parts for the validator', async () => {
    const bare = JSON.stringify({ paragraphs: ['One two three.', 'Four five six.'] });
    const { provider, fetchImpl } = providerFor([bare]);
    await expect(provider.generatePractice(input, signal)).resolves.toEqual({
      title: '', paragraphs: [{ key: 'p1', text: 'One two three.' }, { key: 'p2', text: 'Four five six.' }], usages: [], questions: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts options and explanations of the wrong length instead of asking for a rewrite', async () => {
    const odd = JSON.stringify({ ...practice, questions: [{ ...practice.questions[0], optionsEn: ['govern', 'forget'], correctOptionIndex: 5, optionExplanationsZh: ['对'] }] });
    const { provider, fetchImpl } = providerFor([odd]);
    const generated = await provider.generatePractice(input, signal);
    expect(generated.questions[0]).toMatchObject({ optionsEn: ['govern', 'forget'], correctOptionIndex: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('still asks once for a corrected reply when there is no article at all', async () => {
    const { provider, fetchImpl } = providerFor([JSON.stringify({ title: 'T', paragraphs: [] }), JSON.stringify(practice)]);
    await expect(provider.generatePractice(input, signal)).resolves.toEqual(practice);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const correction = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(correction.messages[3].content).toContain('paragraphs');
  });

  it('gives generation the longer timeout when one is configured', async () => {
    const { provider, generateText } = providerFor([JSON.stringify(practice)], { generationTimeoutMs: 90_000 });
    await provider.generatePractice(input, signal);
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 90_000 }), signal);
    const unset = providerFor([JSON.stringify(practice)]);
    await unset.provider.generatePractice(input, signal);
    expect(unset.generateText.mock.calls[0]![0]).not.toHaveProperty('timeoutMs');
  });
});

describe('the provider has no reviewer', () => {
  it('offers no review call and no review prompt', () => {
    const { provider } = providerFor([]);
    expect('verifyPractice' in provider).toBe(false);
    expect(Object.keys(prompts).filter((name) => /verif|review/iu.test(name))).toEqual([]);
  });
});

describe('prompts', () => {
  it('states the requirements the stored practice depends on, without claiming a code check will reject', () => {
    const system = String(generationMessages(input)[0]!.content);
    expect(system).toContain('Requirements for the artifact');
    expect(system).toContain('Every target must appear in the article exactly once');
    expect(system).toContain('four underscores ____');
    expect(system).toContain('then use every target in the article, then the word range');
    expect(system).toContain('leave every sentence and question that is not affected exactly as it was');
    expect(system).toContain('problems found by automatic checks');
    expect(system).toContain('200-300');
    expect(system).toContain('政治');
    expect(system).not.toMatch(/rejected|review|reviewer|code checks/iu);
  });
});

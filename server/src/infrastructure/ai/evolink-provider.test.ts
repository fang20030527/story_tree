import { describe, expect, it, vi } from 'vitest';

import { EvolinkClient, type EvolinkClientConfig } from './evolink-client';
import { EvolinkAiProvider } from './evolink-provider';

const config: EvolinkClientConfig = {
  apiKey: 'test-secret-api-key',
  baseUrl: 'https://example.invalid/v1',
  textModel: 'test-text-model',
  moderationModel: 'test-moderation-model',
  timeoutMs: 1_000,
};

describe('EvoLink AI provider', () => {
  it('requests JSON mode with the exact array-based generation contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: config.textModel,
        choices: [{ message: { content: JSON.stringify(generatedPractice()) } }],
      }),
    );
    const provider = new EvolinkAiProvider(new EvolinkClient(config, fetchImpl));

    await provider.generatePractice(
      {
        examPath: 'ielts',
        targets: [
          { alias: 't1', term: 'resilient', meaningZh: '有韧性的' },
        ],
      },
      new AbortController().signal,
    );

    const requestBody = requestJson(fetchImpl);
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
    const systemPrompt = String(
      (requestBody.messages as Array<{ content: string }>)[0]?.content,
    );
    expect(systemPrompt).toContain(
      '"paragraphs":[{"key":"p1","text":"..."}]',
    );
    expect(systemPrompt).toContain(
      '"usages":[{"targetAlias":"t1","paragraphKey":"p1","surfaceForm":"..."}]',
    );
    expect(systemPrompt).toContain(
      '"questions":[{"targetAlias":"t1","prompt":"...","optionsZh":["...","...","...","..."],"meaningEn":"...","explanationZh":"...","optionExplanationsZh":["...","...","...","..."]}]',
    );
    expect(systemPrompt).toContain(
      'Return exactly seven paragraphs with keys p1 through p7.',
    );
    expect(systemPrompt).toContain(
      'Each paragraph must contain 105-135 English words.',
    );
    expect(systemPrompt).toContain(
      'The combined article must contain 735-945 English words.',
    );
  });
});

function requestJson(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) {
  const init = fetchImpl.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function generatedPractice() {
  return {
    title: 'A Study of Adaptation',
    paragraphs: [
      { key: 'p1', text: 'First paragraph.' },
      { key: 'p2', text: 'Second paragraph.' },
      { key: 'p3', text: 'Third paragraph.' },
    ],
    usages: [
      { targetAlias: 't1', paragraphKey: 'p1', surfaceForm: 'resilient' },
    ],
    questions: [
      {
        targetAlias: 't1',
        prompt: 'What does the word mean here?',
        optionsZh: ['脆弱的', '有韧性的', '短暂的', '含糊的'],
        meaningEn: 'able to recover',
        explanationZh: '上下文强调恢复能力。',
        optionExplanationsZh: [
          '含义相反。',
          '符合语境。',
          '与语境无关。',
          '与语境无关。',
        ],
      },
    ],
  };
}

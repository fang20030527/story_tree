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
    const provider = createProvider(fetchImpl);

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

  it('uses the dedicated vision model, timeout, and strict multimodal JSON request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: 'test-vision-model',
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Synthetic OCR title',
                text: 'Original visible article text.',
              }),
            },
          },
        ],
      }),
    );
    const client = new EvolinkClient(config, fetchImpl);
    const generateText = vi.spyOn(client, 'generateText');
    const provider = new EvolinkAiProvider(client, {
      visionModel: 'test-vision-model',
      visionTimeoutMs: 120_000,
    });
    await expect(
      provider.extractArticleText(
        [
          {
            position: 0,
            mediaType: 'image/jpeg',
            base64: 'dGVzdA==',
          },
        ],
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      title: 'Synthetic OCR title',
      text: 'Original visible article text.',
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-vision-model',
        timeoutMs: 120_000,
        responseFormat: 'json_object',
      }),
      expect.any(AbortSignal),
    );
    const requestBody = requestJson(fetchImpl);
    expect(requestBody).toMatchObject({
      model: 'test-vision-model',
      stream: false,
      response_format: { type: 'json_object' },
    });
    const content = (
      requestBody.messages as Array<{ content: Array<Record<string, unknown>> }>
    )[0]?.content;
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringMatching(/strict JSON/iu) }),
        { type: 'text', text: 'Image position: 0' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,dGVzdA==' },
        },
      ]),
    );
  });

  it('sends a selected word and context to the concise lookup prompt', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: config.textModel,
        choices: [{ message: { content: '有韧性的；能复原的' } }],
      }),
    );
    const provider = createProvider(fetchImpl);

    await expect(
      provider.lookupWord(
        'resilient',
        'A resilient reader updates context.',
        new AbortController().signal,
      ),
    ).resolves.toBe('有韧性的；能复原的');

    const requestBody = requestJson(fetchImpl);
    expect(requestBody).toMatchObject({
      model: config.textModel,
      stream: false,
      max_completion_tokens: 200,
      reasoning_effort: 'low',
    });
    const messages = requestBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('contextual meaning');
    expect(JSON.parse(messages[1]?.content ?? '')).toEqual({
      term: 'resilient',
      context: 'A resilient reader updates context.',
    });
  });

  it('parses a structured part-of-speech and meaning response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: config.textModel,
        choices: [{
          message: {
            content: JSON.stringify({
              partOfSpeech: '形容词',
              meaningZh: '有韧性的；能复原的',
            }),
          },
        }],
      }),
    );

    await expect(
      createProvider(fetchImpl).lookupWord(
        'resilient',
        'A resilient reader updates context.',
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      partOfSpeech: '形容词',
      meaningZh: '有韧性的；能复原的',
    });

    const requestBody = requestJson(fetchImpl);
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
  });

  it.each([
    '',
    'not-json',
    JSON.stringify({ title: null }),
    JSON.stringify({ title: null, text: 'visible', extra: true }),
    JSON.stringify({ title: '', text: 'visible' }),
  ])('rejects invalid OCR output %j', async (output) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: output } }] }),
    );
    await expect(
      createProvider(fetchImpl).extractArticleText(
        [{ position: 0, mediaType: 'image/png', base64: 'dGVzdA==' }],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
});

function createProvider(fetchImpl: typeof fetch) {
  return new EvolinkAiProvider(new EvolinkClient(config, fetchImpl), {
    visionModel: 'test-vision-model',
    visionTimeoutMs: 120_000,
  });
}

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

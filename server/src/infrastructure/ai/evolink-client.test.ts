import { describe, expect, it, vi } from 'vitest';

import { EvolinkClient, type EvolinkClientConfig } from './evolink-client';

const apiKey = 'test-secret-api-key';
const config: EvolinkClientConfig = {
  apiKey,
  baseUrl: 'https://example.invalid/v1/',
  textModel: 'test-text-model',
  moderationModel: 'test-moderation-model',
  timeoutMs: 20,
};

describe('EvoLink HTTP client', () => {
  it('parses text parts and moderation responses through strict boundaries', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'chat-1',
          model: 'test-text-model',
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: ' hello ' },
                  { type: 'text', text: 'world' },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'mod-1',
          model: 'test-moderation-model',
          results: [{ flagged: false }],
          evolink_summary: { risk_level: 'low', flagged: false },
        }),
      );
    const client = new EvolinkClient(config, fetchImpl);
    const signal = new AbortController().signal;

    await expect(
      client.generateText(
        { messages: [{ role: 'user', content: 'Say hello' }] },
        signal,
      ),
    ).resolves.toMatchObject({ text: 'hello world', model: 'test-text-model' });
    await expect(client.moderateText('safe text', signal)).resolves.toEqual({
      riskLevel: 'low',
      flagged: false,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://example.invalid/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: `Bearer ${apiKey}` }),
      }),
    );
  });

  it('maps rate limits, invalid output, and timeouts without exposing the key', async () => {
    const rateLimited = new EvolinkClient(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ error: { message: `do not expose ${apiKey}` } }, 429),
      ),
    );
    const invalid = new EvolinkClient(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('not-json', { status: 200 }),
      ),
    );
    const delayed = new EvolinkClient(
      { ...config, timeoutMs: 5 },
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          if (!(signal instanceof AbortSignal)) {
            reject(new Error('Expected an abort signal'));
            return;
          }
          const rejectAbort = () => reject(signal.reason);
          if (signal.aborted) rejectAbort();
          else signal.addEventListener('abort', rejectAbort, { once: true });
        });
      }),
    );
    const signal = new AbortController().signal;

    const errors = await Promise.all([
      capture(rateLimited.generateText({ messages: userMessage() }, signal)),
      capture(invalid.generateText({ messages: userMessage() }, signal)),
      capture(delayed.generateText({ messages: userMessage() }, signal)),
    ]);
    expect(errors[0]).toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });
    expect(errors[1]).toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect(errors[2]).toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });
    for (const error of errors) {
      expect(`${error.message}\n${error.stack ?? ''}`).not.toContain(apiKey);
    }
  });

  it('rejects an assistant message in the final Gemini position', async () => {
    const client = new EvolinkClient(config, vi.fn<typeof fetch>());
    await expect(
      client.generateText(
        { messages: [{ role: 'assistant', content: 'prefill' }] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT', retryable: false });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function userMessage() {
  return [{ role: 'user' as const, content: 'hello' }];
}

async function capture(promise: Promise<unknown>): Promise<Error & Record<string, unknown>> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }
}

import { z } from 'zod';

import { AppError } from '../../core/errors';

const ContentPartSchema = z.union([
  z.string(),
  z.object({ text: z.string() }).passthrough(),
]);

const ChatCompletionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.union([z.string(), z.array(ContentPartSchema)]),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export interface EvolinkClientConfig {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  timeoutMs: number;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
};

export interface GenerateTextInput {
  messages: ChatMessage[];
  model?: string;
  maxCompletionTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  responseFormat?: 'json_object';
  timeoutMs?: number;
}

export interface GeneratedText {
  text: string;
  model: string;
}

export class EvolinkClient {
  private readonly config: EvolinkClientConfig;

  constructor(
    config: EvolinkClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/u, '') };
  }

  async generateText(
    input: GenerateTextInput,
    signal: AbortSignal,
  ): Promise<GeneratedText> {
    if (
      input.messages.length === 0 ||
      input.messages.at(-1)?.role === 'assistant'
    ) {
      throw new AppError('AI_INVALID_OUTPUT', 'AI 请求格式无效', 500);
    }

    const model = input.model ?? this.config.textModel;
    const data = await this.postJson(
      '/chat/completions',
      {
        model,
        messages: input.messages,
        stream: false,
        ...(input.maxCompletionTokens === undefined
          ? {}
          : { max_completion_tokens: input.maxCompletionTokens }),
        ...(input.reasoningEffort === undefined
          ? {}
          : { reasoning_effort: input.reasoningEffort }),
        ...(input.responseFormat === undefined
          ? {}
          : { response_format: { type: input.responseFormat } }),
      },
      signal,
      input.timeoutMs,
    );
    const parsed = ChatCompletionSchema.safeParse(data);
    if (!parsed.success) throw invalidOutput();

    const content = parsed.data.choices[0]!.message.content;
    const text = (
      typeof content === 'string'
        ? content
        : content
            .map((part) => (typeof part === 'string' ? part : part.text))
            .join('')
    ).trim();
    if (!text) throw invalidOutput();

    return { text, model: parsed.data.model ?? model };
  }

  private async postJson(
    path: string,
    body: unknown,
    signal: AbortSignal,
    timeoutMs = this.config.timeoutMs,
  ): Promise<unknown> {
    if (signal.aborted) throw abortError();

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch {
      if (signal.aborted) throw abortError();
      if (timeoutSignal.aborted) throw unavailable(true);
      throw unavailable(true);
    }

    if (signal.aborted) throw abortError();
    if (timeoutSignal.aborted) throw unavailable(true);
    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw unavailable(retryable);
    }

    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      if (signal.aborted) throw abortError();
      if (timeoutSignal.aborted) throw unavailable(true);
      throw unavailable(true);
    }

    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      throw invalidOutput();
    }
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function invalidOutput(): AppError {
  return new AppError('AI_INVALID_OUTPUT', 'AI 返回格式无效', 502, true);
}

function unavailable(retryable: boolean): AppError {
  return new AppError('AI_UNAVAILABLE', 'AI 服务暂时不可用', 503, retryable);
}

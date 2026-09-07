import { AppError } from '../../core/errors';
import { EvolinkClient } from './evolink-client';
import {
  GeneratedPracticeSchema,
  VerificationSchema,
  type GeneratedPractice,
  type Verification,
} from './generated-schemas';
import { extractJsonObject } from './json';
import {
  generationMessages,
  translationMessages,
  verificationMessages,
} from './prompts';
import type {
  AiProvider,
  GeneratePracticeInput,
  ModerationResult,
  VerifyPracticeInput,
} from './types';

export class EvolinkAiProvider implements AiProvider {
  constructor(private readonly client: EvolinkClient) {}

  async generatePractice(
    input: GeneratePracticeInput,
    signal: AbortSignal,
  ): Promise<GeneratedPractice> {
    const response = await this.client.generateText(
      {
        messages: generationMessages(input),
        maxCompletionTokens: 12_000,
        reasoningEffort: 'low',
        responseFormat: 'json_object',
      },
      signal,
    );
    return parseGeneratedPractice(response.text);
  }

  async verifyPractice(
    input: VerifyPracticeInput,
    signal: AbortSignal,
  ): Promise<Verification> {
    const response = await this.client.generateText(
      {
        messages: verificationMessages(input),
        maxCompletionTokens: 2_000,
        reasoningEffort: 'low',
        responseFormat: 'json_object',
      },
      signal,
    );
    const parsed = VerificationSchema.safeParse(extractJsonObject(response.text));
    if (!parsed.success) throw invalidOutput();
    return parsed.data;
  }

  async translate(text: string, signal: AbortSignal): Promise<string> {
    const response = await this.client.generateText(
      {
        messages: translationMessages(text),
        maxCompletionTokens: 6_000,
        reasoningEffort: 'low',
      },
      signal,
    );
    return response.text;
  }

  moderate(text: string, signal: AbortSignal): Promise<ModerationResult> {
    return this.client.moderateText(text, signal);
  }
}

function parseGeneratedPractice(text: string): GeneratedPractice {
  const parsed = GeneratedPracticeSchema.safeParse(extractJsonObject(text));
  if (!parsed.success) throw invalidOutput();
  return parsed.data;
}

function invalidOutput(): AppError {
  return new AppError('AI_INVALID_OUTPUT', 'AI 返回格式无效', 502, true);
}

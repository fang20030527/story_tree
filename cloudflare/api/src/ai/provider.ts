import { AppError } from '../../../../server/src/core/errors';
import {
  EvolinkClient,
  type EvolinkClientConfig,
  type GenerateTextInput,
  type GeneratedText,
} from '../../../../server/src/infrastructure/ai/evolink-client';
import { EvolinkAiProvider } from '../../../../server/src/infrastructure/ai/evolink-provider';
import type { ApiEnv } from '../env';
import { consumeAiCall } from './budget';

/**
 * Counts every upstream call against the site-wide daily AI cap before sending it. Counting
 * here rather than in fetch keeps the cap's own error: the client turns any fetch failure into
 * a retryable "AI unavailable", which would make jobs retry a call that cannot succeed today.
 */
class CountedEvolinkClient extends EvolinkClient {
  constructor(config: EvolinkClientConfig, private readonly env: ApiEnv) {
    super(config);
  }

  override async generateText(input: GenerateTextInput, signal: AbortSignal): Promise<GeneratedText> {
    await consumeAiCall(this.env);
    return super.generateText(input, signal);
  }
}

function positiveMilliseconds(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AppError('INTERNAL_ERROR', 'AI 服务配置无效', 500, true);
  }
  return number;
}

export function generationDeadlineMs(env: ApiEnv): number {
  return positiveMilliseconds(env.GENERATION_DEADLINE_MS, 120_000);
}

export function evolinkProvider(env: ApiEnv): EvolinkAiProvider {
  if (!env.EVOLINK_API_KEY) {
    throw new AppError('AI_UNAVAILABLE', '翻译服务暂时不可用', 503, true);
  }
  const baseUrl = env.EVOLINK_BASE_URL ?? 'https://direct.evolink.ai/v1';
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError('INTERNAL_ERROR', 'AI 服务配置无效', 500, true);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AppError('INTERNAL_ERROR', 'AI 服务配置无效', 500, true);
  }
  const timeoutMs = positiveMilliseconds(env.EVOLINK_TIMEOUT_MS, 60_000);
  const client = new CountedEvolinkClient({
    apiKey: env.EVOLINK_API_KEY,
    baseUrl: url.toString(),
    textModel: env.EVOLINK_TEXT_MODEL ?? 'gpt-6-luna',
    timeoutMs,
  }, env);
  const deadline = generationDeadlineMs(env);
  return new EvolinkAiProvider(client, {
    visionModel: env.EVOLINK_VISION_MODEL ?? 'deepseek-v4-flash-vision-exp',
    visionTimeoutMs: positiveMilliseconds(env.EVOLINK_VISION_TIMEOUT_MS, 120_000),
    translationTimeoutMs: Math.max(1, deadline - Math.min(15_000, Math.floor(deadline / 5))),
    // An article with ten bilingual questions is a long reply; do not cut it off at the short-call limit.
    generationTimeoutMs: Math.max(timeoutMs, 90_000),
  });
}

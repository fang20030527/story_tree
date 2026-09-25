import { AppError } from '../../../../server/src/core/errors';
import { EvolinkClient } from '../../../../server/src/infrastructure/ai/evolink-client';
import { EvolinkAiProvider } from '../../../../server/src/infrastructure/ai/evolink-provider';
import type { ApiEnv } from '../env';

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
  const client = new EvolinkClient({
    apiKey: env.EVOLINK_API_KEY,
    baseUrl: url.toString(),
    textModel: env.EVOLINK_TEXT_MODEL ?? 'gpt-6-luna',
    timeoutMs: positiveMilliseconds(env.EVOLINK_TIMEOUT_MS, 60_000),
  });
  const deadline = generationDeadlineMs(env);
  return new EvolinkAiProvider(client, {
    visionModel: env.EVOLINK_VISION_MODEL ?? 'deepseek-v4-flash-vision-exp',
    visionTimeoutMs: positiveMilliseconds(env.EVOLINK_VISION_TIMEOUT_MS, 120_000),
    translationTimeoutMs: Math.max(1, deadline - Math.min(15_000, Math.floor(deadline / 5))),
  });
}

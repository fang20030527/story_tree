import { AppError, errorCodes } from '../../../../server/src/core/errors';
import type { NormalizedImportContent } from '../../../../server/src/modules/imports/content';
import type { GeneratedPractice } from '../../../../server/src/infrastructure/ai/generated-schemas';
import { ImportedArticleMediaSchema, type AnswerResult } from '@context-reader/contracts';
import type { AnswerSubmission } from '../practice/answer-write';
import {
  PracticeValidationError,
  type GenerationTarget,
  type ValidatedGeneratedPractice,
} from '../../../../server/src/modules/practice/generation-validator';
import type { ApiEnv } from '../env';
import type {
  CpuBoundaryStub,
  CpuNormalizeInput,
  CpuNormalizedContent,
  CpuResult,
} from './types';

const knownErrorCodes = new Set<string>(errorCodes);

function unavailable(): AppError {
  return new AppError('INTERNAL_ERROR', '服务暂时无法完成请求', 503, true);
}

function randomShard(): string {
  // Stateless CPU work can use many object instances; a global singleton would
  // serialize all scrypt and article-normalization calls.
  const shard = crypto.getRandomValues(new Uint8Array(1))[0]!;
  return `cpu-${shard.toString(16).padStart(2, '0')}`;
}

async function invoke<T>(
  env: ApiEnv,
  call: (stub: CpuBoundaryStub) => Promise<CpuResult<T>>,
  name = randomShard(),
): Promise<T> {
  const namespace = env.CPU_BOUNDARY;
  if (!namespace) throw unavailable();
  let result: CpuResult<T>;
  try {
    // A new stub is used for every call; an exception can break an old stub.
    result = await call(namespace.getByName(name));
  } catch {
    throw unavailable();
  }
  if (!result || typeof result !== 'object') throw unavailable();
  if (result.ok) return result.value;
  if (!result.error || !knownErrorCodes.has(result.error.code) ||
      typeof result.error.message !== 'string' ||
      !Number.isInteger(result.error.statusCode) ||
      result.error.statusCode < 400 || result.error.statusCode > 599 ||
      typeof result.error.retryable !== 'boolean') {
    throw unavailable();
  }
  if (result.error.code === 'AI_INVALID_OUTPUT' &&
      typeof result.error.repairIssue === 'string' &&
      result.error.repairIssue.length <= 500) {
    throw new PracticeValidationError(result.error.repairIssue);
  }
  throw new AppError(
    result.error.code,
    result.error.message,
    result.error.statusCode,
    result.error.retryable,
  );
}

function fromWire(content: CpuNormalizedContent): NormalizedImportContent {
  try {
    if (!content || typeof content.title !== 'string' ||
        typeof content.text !== 'string' ||
        !Array.isArray(content.paragraphs) ||
        !ImportedArticleMediaSchema.array().max(100).safeParse(content.media).success ||
        !Number.isInteger(content.wordCount) ||
        typeof content.contentHash !== 'string' ||
        typeof content.similarityFingerprint !== 'string' ||
        !/^-?\d{1,20}$/u.test(content.similarityFingerprint)) {
      throw unavailable();
    }
    const fingerprint = BigInt(content.similarityFingerprint);
    if (BigInt.asIntN(64, fingerprint) !== fingerprint) throw unavailable();
    return {
      ...content,
      similarityFingerprint: fingerprint,
    };
  } catch {
    throw unavailable();
  }
}

export function hashEmailPasswordOnCpuBoundary(
  env: ApiEnv,
  password: string,
): Promise<string> {
  return invoke(env, (stub) => stub.hashPassword(password)).then((value) => {
    if (typeof value !== 'string' || !value.startsWith('scrypt-v1$')) {
      throw unavailable();
    }
    return value;
  });
}

export function verifyEmailPasswordOnCpuBoundary(
  env: ApiEnv,
  password: string,
  encodedHash: string,
): Promise<boolean> {
  return invoke(env, (stub) => stub.verifyPassword(password, encodedHash)).then((value) => {
    if (typeof value !== 'boolean') throw unavailable();
    return value;
  });
}

export async function normalizeImportContentOnCpuBoundary(
  env: ApiEnv,
  input: CpuNormalizeInput,
): Promise<NormalizedImportContent> {
  return fromWire(await invoke(env, (stub) => stub.normalizeContent(input)));
}

export async function normalizePastedContentOnCpuBoundary(
  env: ApiEnv,
  text: string,
): Promise<NormalizedImportContent> {
  return fromWire(await invoke(env, (stub) => stub.normalizePastedText(text)));
}

export async function extractHtmlOnCpuBoundary(
  env: ApiEnv,
  html: string,
  finalUrl: string,
): Promise<NormalizedImportContent> {
  return fromWire(await invoke(env, (stub) => stub.extractHtml(html, finalUrl)));
}

export function validatePracticeOnCpuBoundary(
  env: ApiEnv,
  generated: GeneratedPractice,
  targets: GenerationTarget[],
  length: 'long' | 'short',
): Promise<ValidatedGeneratedPractice> {
  return invoke(env, (stub) => stub.validatePractice(generated, targets, length));
}

export function submitAnswerOnCpuBoundary(
  env: ApiEnv,
  input: AnswerSubmission,
): Promise<AnswerResult> {
  return invoke(env, (stub) => stub.submitAnswer(input), `answer-${input.userId}`);
}

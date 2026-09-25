import type { ErrorCode } from '../../../../server/src/core/errors';
import type { AnswerResult } from '@context-reader/contracts';
import type { AnswerSubmission } from '../practice/answer-write';
import type { GeneratedPractice } from '../../../../server/src/infrastructure/ai/generated-schemas';
import type {
  GenerationTarget,
  ValidatedGeneratedPractice,
} from '../../../../server/src/modules/practice/generation-validator';

export interface CpuNormalizeInput {
  title: string | null;
  text: string;
}

// BigInt is encoded as decimal text so the result can also be used in D1 and JSON.
export interface CpuNormalizedContent {
  title: string;
  text: string;
  paragraphs: string[];
  wordCount: number;
  contentHash: string;
  similarityFingerprint: string;
}

export interface CpuFailure {
  code: ErrorCode;
  message: string;
  statusCode: number;
  retryable: boolean;
  repairIssue?: string;
}

export type CpuResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CpuFailure };

// This is the small RPC surface needed until Wrangler-generated Env types are
// added when the binding is enabled. The Durable Object does not persist data.
export interface CpuBoundaryStub {
  hashPassword(password: string): Promise<CpuResult<string>>;
  verifyPassword(password: string, encodedHash: string): Promise<CpuResult<boolean>>;
  normalizeContent(input: CpuNormalizeInput): Promise<CpuResult<CpuNormalizedContent>>;
  extractHtml(html: string, finalUrl: string): Promise<CpuResult<CpuNormalizedContent>>;
  normalizePastedText(text: string): Promise<CpuResult<CpuNormalizedContent>>;
  validatePractice(
    generated: GeneratedPractice,
    targets: GenerationTarget[],
    length: 'long' | 'short',
  ): Promise<CpuResult<ValidatedGeneratedPractice>>;
  submitAnswer(input: AnswerSubmission): Promise<CpuResult<AnswerResult>>;
}

export interface CpuBoundaryNamespace {
  getByName(name: string): CpuBoundaryStub;
}

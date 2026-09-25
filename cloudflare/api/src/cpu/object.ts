import { DurableObject } from 'cloudflare:workers';
import type { AnswerResult } from '@context-reader/contracts';

import { AppError } from '../../../../server/src/core/errors';
import type { GeneratedPractice } from '../../../../server/src/infrastructure/ai/generated-schemas';
import {
  PracticeValidationError,
  validateGeneratedPractice,
  type GenerationTarget,
  type ValidatedGeneratedPractice,
} from '../../../../server/src/modules/practice/generation-validator';
import {
  hashEmailPassword,
  verifyEmailPassword,
} from '../../../../server/src/modules/auth/email-password';
import {
  normalizeImportContent,
  normalizePastedContent,
  type NormalizedImportContent,
} from '../../../../server/src/modules/imports/content';
import { extractReadableHtml } from '../../../../server/src/modules/imports/extractors/html';
import type {
  CpuNormalizeInput,
  CpuNormalizedContent,
  CpuResult,
} from './types';
import type { ApiEnv } from '../env';
import { submitAnswerOnD1, type AnswerSubmission } from '../practice/answer-write';

const MAX_PASTED_TEXT_BYTES = 128 * 1024;

function invalidInput(): AppError {
  return new AppError('VALIDATION_ERROR', '请检查输入内容', 400);
}

function toWire(content: NormalizedImportContent): CpuNormalizedContent {
  return {
    title: content.title,
    text: content.text,
    paragraphs: content.paragraphs,
    media: content.media,
    wordCount: content.wordCount,
    contentHash: content.contentHash,
    similarityFingerprint: content.similarityFingerprint.toString(),
  };
}

async function safely<T>(work: () => T | Promise<T>): Promise<CpuResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          retryable: error.retryable,
          ...(error instanceof PracticeValidationError
            ? { repairIssue: error.repairIssue } : {}),
        },
      };
    }
    // No password, hash, article text, or upstream error detail crosses RPC.
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时无法完成请求',
        statusCode: 500,
        retryable: true,
      },
    };
  }
}

/**
 * SQLite-backed Durable Object for expensive CPU work and per-user answer
 * serialization. Synthetic scrypt plus long-article calls were measured on
 * this Free account at 239-253 ms DO CPU with successful outcomes. Business
 * routes remain closed until final D1 data and answer concurrency are checked.
 */
export class CpuBoundary extends DurableObject<ApiEnv> {
  private answerTail: Promise<void> = Promise.resolve();

  async submitAnswer(input: AnswerSubmission): Promise<CpuResult<AnswerResult>> {
    const previous = this.answerTail;
    let release!: () => void;
    this.answerTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await safely(() => submitAnswerOnD1(this.env.DB, input));
    } finally {
      release();
    }
  }

  async hashPassword(password: string): Promise<CpuResult<string>> {
    return safely(() => {
      if (typeof password !== 'string') throw invalidInput();
      // Preserve scrypt-v1, including salt size, work factors, and encoding.
      return hashEmailPassword(password);
    });
  }

  async verifyPassword(
    password: string,
    encodedHash: string,
  ): Promise<CpuResult<boolean>> {
    return safely(() => {
      if (typeof password !== 'string' || typeof encodedHash !== 'string') {
        throw invalidInput();
      }
      return verifyEmailPassword(password, encodedHash);
    });
  }

  async normalizeContent(
    input: CpuNormalizeInput,
  ): Promise<CpuResult<CpuNormalizedContent>> {
    return safely(() => {
      if (!input || typeof input !== 'object' ||
          (input.title !== null && typeof input.title !== 'string') ||
          typeof input.text !== 'string' ||
          (input.media !== undefined && !Array.isArray(input.media))) {
        throw invalidInput();
      }
      return toWire(normalizeImportContent(input));
    });
  }

  async normalizePastedText(text: string): Promise<CpuResult<CpuNormalizedContent>> {
    return safely(() => {
      if (typeof text !== 'string') throw invalidInput();
      if (new TextEncoder().encode(text).byteLength > MAX_PASTED_TEXT_BYTES) {
        throw new AppError('IMPORT_TOO_LARGE', '上传内容过大', 413);
      }
      // The API still must enforce exact raw Content-Length and strict UTF-8.
      return toWire(normalizePastedContent(text));
    });
  }

  async extractHtml(html: string, finalUrl: string): Promise<CpuResult<CpuNormalizedContent>> {
    return safely(() => {
      if (typeof html !== 'string' || typeof finalUrl !== 'string' ||
          new TextEncoder().encode(html).byteLength > 5_242_880) {
        throw invalidInput();
      }
      return toWire(normalizeImportContent(extractReadableHtml(html, finalUrl)));
    });
  }

  async validatePractice(
    generated: GeneratedPractice,
    targets: GenerationTarget[],
    length: 'long' | 'short',
  ): Promise<CpuResult<ValidatedGeneratedPractice>> {
    return safely(() => validateGeneratedPractice(generated, targets, length));
  }
}

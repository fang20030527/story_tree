import { describe, expect, it, vi } from 'vitest';

import { PracticeValidationError } from '../../../../server/src/modules/practice/generation-validator';
import { fixtureArticle, fixtureTargets } from '../../../../server/src/modules/practice/generation-test-fixtures';
import type { ApiEnv } from '../env';
import { validatePracticeOnCpuBoundary } from './client';
import type { CpuFailure, CpuResult } from './types';

function envReturning(result: CpuResult<never>) {
  const validatePractice = vi.fn(async () => result);
  const env = { CPU_BOUNDARY: { getByName: () => ({ validatePractice }) } } as unknown as ApiEnv;
  return { env, validatePractice };
}

const rejected = (error: Partial<CpuFailure>): CpuResult<never> => ({
  ok: false,
  error: { code: 'AI_INVALID_OUTPUT', message: '生成内容未通过结构检查', statusCode: 502, retryable: true, ...error },
});

async function failure(result: CpuResult<never>): Promise<unknown> {
  const { env } = envReturning(result);
  return validatePracticeOnCpuBoundary(env, fixtureArticle(), fixtureTargets, 'short').catch((cause: unknown) => cause);
}

describe('practice validation across the CPU boundary', () => {
  it('carries every problem and its code back to the Worker', async () => {
    const error = await failure(rejected({
      repairIssue: 'first', repairIssues: ['first', 'second'], issueCodes: ['WORD_COUNT', 'QUESTION'],
    }));
    expect(error).toBeInstanceOf(PracticeValidationError);
    expect(error).toMatchObject({ repairIssues: ['first', 'second'], issueCodes: ['WORD_COUNT', 'QUESTION'], retryable: true });
  });

  it('still understands a single repairIssue from an older Durable Object', async () => {
    const error = await failure(rejected({ repairIssue: 'only one' }));
    expect(error).toBeInstanceOf(PracticeValidationError);
    expect(error).toMatchObject({ repairIssues: ['only one'] });
  });

  it('drops malformed or oversized entries instead of trusting the payload', async () => {
    const error = await failure(rejected({
      repairIssues: ['fine', 42 as unknown as string, '', 'x'.repeat(501), ...Array.from({ length: 20 }, (_, index) => `issue ${index}`)],
      issueCodes: ['OK', 7 as unknown as string, 'C'.repeat(41)],
    })) as PracticeValidationError;
    expect(error.repairIssues[0]).toBe('fine');
    expect(error.repairIssues).toHaveLength(12);
    expect(error.repairIssues.every((issue) => typeof issue === 'string' && issue.length > 0 && issue.length <= 500)).toBe(true);
    expect(error.issueCodes).toEqual(['OK']);
  });

  it('reports any other failure as an ordinary application error', async () => {
    const error = await failure(rejected({ code: 'INTERNAL_ERROR', statusCode: 500, message: '服务暂时无法完成请求' }));
    expect(error).not.toBeInstanceOf(PracticeValidationError);
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true });
  });

  it('passes the validation options and the vocabulary terms to the Durable Object', async () => {
    const { env, validatePractice } = envReturning({ ok: true, value: 'validated' as never });
    await expect(validatePracticeOnCpuBoundary(env, fixtureArticle(), fixtureTargets, 'short', { completeMissing: true }))
      .resolves.toBe('validated');
    expect(validatePractice).toHaveBeenCalledWith(expect.anything(), fixtureTargets, 'short', { completeMissing: true });
    expect(fixtureTargets.every((target) => typeof target.term === 'string')).toBe(true);
  });
});

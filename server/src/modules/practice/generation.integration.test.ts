import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { withTestDatabase } from '../../../test/database';
import { AppError } from '../../core/errors';
import {
  jobs,
  practiceParagraphs,
  practiceQuestions,
  practiceSessions,
  practiceTargets,
  usageLedger,
} from '../../db/schema';
import { FakeAiProvider } from '../../infrastructure/ai/fake-provider';
import { registerAnonymous } from '../auth/service';
import { claimNextJob } from '../jobs/repository';
import { createPractice } from './create-service';
import {
  failPracticeGeneration,
  handlePracticeGeneration,
} from './generation-handler';

describe('practice generation', () => {
  it('repairs short article structure and review issues in one request without publishing failed drafts', async () => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '80'.repeat(32), true);
      const created = await createPractice(db, {
        userId: user.userId, idempotencyKey: 'generation-structure-0001',
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
        format: 'topic_set', freeLimit: 3, generationDeadlineMs: 120_000,
      });
      const job = (await claimNextJob(db, 'structure-worker', 120_000, ['practice_generation']))!;
      const provider = new FakeAiProvider();
      const originalGenerate = provider.generatePractice.bind(provider);
      const generate = vi.spyOn(provider, 'generatePractice')
        .mockImplementationOnce(async (input, signal) => {
          const draft = await originalGenerate(input, signal);
          draft.paragraphs[0]!.text += ` ${'study '.repeat(100)}`;
          return draft;
        })
        .mockImplementationOnce(async (input, signal) => {
          expect(input.revision?.issues[0]).toContain('200-300');
          const draft = await originalGenerate(input, signal);
          draft.questions[0]!.prompt = 'Missing blank.';
          return draft;
        })
        .mockImplementation(async (input, signal) => {
          expect(await practiceState(db, job.resourceId)).not.toBe('failed');
          expect(await db.select().from(practiceParagraphs)).toHaveLength(0);
          return originalGenerate(input, signal);
        });
      const verify = vi.spyOn(provider, 'verifyPractice')
        .mockResolvedValueOnce({ approved: false, issues: ['Make the distractors unambiguous.'] })
        .mockResolvedValueOnce({ approved: true, issues: [] });

      await handlePracticeGeneration({ db, provider, modelName: 'fake' }, job, { signal: new AbortController().signal });

      expect(generate).toHaveBeenCalledTimes(4);
      expect(generate.mock.calls[2]![0].revision?.issues[0]).toContain('____');
      expect(generate.mock.calls[3]![0].revision?.issues).toEqual(['Make the distractors unambiguous.']);
      expect(verify).toHaveBeenCalledTimes(2);
      expect(await practiceState(db, job.resourceId)).toBe('ready');
      expect(await db.select().from(practiceParagraphs)).toHaveLength(3);
      const ledger = await db.select().from(usageLedger).where(eq(usageLedger.practiceSessionId, created.practiceId));
      expect(ledger.map((entry) => entry.kind)).toEqual(['reserve']);
    });
  }, 120_000);

  it('revises rejected content using review feedback before publishing', async () => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '79'.repeat(32), true);
      const created = await createPractice(db, {
        userId: user.userId, idempotencyKey: 'generation-revision-0001',
        items: [{ term: 'resilient', meaningZh: '有韧性的' }],
        freeLimit: 3, generationDeadlineMs: 120_000,
      });
      const job = await claimNextJob(db, 'revision-worker', 120_000, ['practice_generation']);
      const provider = new FakeAiProvider();
      const generate = vi.spyOn(provider, 'generatePractice');
      const verify = vi.spyOn(provider, 'verifyPractice')
        .mockResolvedValueOnce({ approved: false, issues: ['Make the distractors unambiguous.'] })
        .mockResolvedValueOnce({ approved: true, issues: [] });
      await handlePracticeGeneration({ db, provider, modelName: 'fake' }, job!, { signal: new AbortController().signal });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls[1]![0].revision?.issues).toEqual(['Make the distractors unambiguous.']);
      expect(verify).toHaveBeenCalledTimes(2);
      expect(await practiceState(db, created.practiceId)).toBe('ready');
    });
  }, 120_000);

  it('persists one immutable validated artifact and commits reserved quota', async () => {
    await withTestDatabase(async ({ db }) => {
      const user = await registerAnonymous(db, '71'.repeat(32), true);
      const created = await createPractice(db, {
        userId: user.userId,
        idempotencyKey: 'generation-happy-0001',
        items: [
          { term: 'resilient', meaningZh: '有韧性的' },
          { term: 'ambiguous', meaningZh: '模棱两可的' },
          { term: 'meticulous', meaningZh: '一丝不苟的' },
        ],
        freeLimit: 3,
        generationDeadlineMs: 120_000,
      });
      const job = await claimNextJob(
        db,
        'generation-worker',
        60_000,
        ['practice_generation'],
      );
      expect(job?.resourceId).toBe(created.practiceId);

      const provider = new FakeAiProvider();
      const generate = vi.spyOn(provider, 'generatePractice');
      const verify = vi.spyOn(provider, 'verifyPractice');
      const moderate = vi.spyOn(provider, 'moderate');
      const context = { signal: new AbortController().signal };
      const options = { db, provider, modelName: 'fake-ielts-v1' };

      await handlePracticeGeneration(options, job!, context);
      await handlePracticeGeneration(options, job!, context);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(moderate).toHaveBeenCalledTimes(2);

      const [practice] = await db
        .select()
        .from(practiceSessions)
        .where(eq(practiceSessions.id, created.practiceId));
      expect(practice).toMatchObject({
        status: 'ready',
        modelName: 'fake-ielts-v1',
        promptVersion: 'ielts-generation-bilingual-feedback-v4',
      });
      expect(practice?.articleWordCount).toBeGreaterThanOrEqual(700);
      expect(practice?.articleWordCount).toBeLessThanOrEqual(1_000);
      expect(practice?.readyAt).toBeInstanceOf(Date);

      expect(
        await db
          .select()
          .from(practiceParagraphs)
          .where(eq(practiceParagraphs.practiceSessionId, created.practiceId)),
      ).toHaveLength(3);
      const targets = await db
        .select()
        .from(practiceTargets)
        .where(eq(practiceTargets.practiceSessionId, created.practiceId));
      expect(targets).toHaveLength(3);
      for (const target of targets) {
        expect(target).toMatchObject({
          paragraphId: expect.any(String),
          surfaceForm: expect.any(String),
          startOffset: expect.any(Number),
          endOffset: expect.any(Number),
        });
      }
      const questions = await db.select().from(practiceQuestions);
      expect(questions).toHaveLength(3);
      for (const question of questions) {
        expect(question.explanationZh).toMatch(/\p{Script=Han}/u);
        expect(question.explanationZh).not.toMatch(/[a-z]/i);
        for (const option of question.optionsJson) {
          const [zh, en] = question.optionExplanationsJson[option.id]!.split('\n');
          expect(zh).toMatch(/\p{Script=Han}/u);
          expect(en).toMatch(/[a-z]/i);
          expect(en).not.toMatch(/\p{Script=Han}/u);
        }
      }
      expect(
        await db
          .select({ kind: usageLedger.kind })
          .from(usageLedger)
          .where(eq(usageLedger.practiceSessionId, created.practiceId)),
      ).toEqual(expect.arrayContaining([{ kind: 'reserve' }, { kind: 'commit' }]));
      expect(
        await db
          .select({ status: jobs.status })
          .from(jobs)
          .where(eq(jobs.id, job!.id)),
      ).toEqual([{ status: 'running' }]);
    });
  }, 120_000);

  it('classifies safety, verification, deadline, and lease failures without partial writes', async () => {
    await withTestDatabase(async ({ db }) => {
      let sequence = 0;
      const createClaim = async (label: string) => {
        sequence += 1;
        const user = await registerAnonymous(
          db,
          sequence.toString(16).padStart(2, '0').repeat(32),
          true,
        );
        const created = await createPractice(db, {
          userId: user.userId,
          idempotencyKey: `${label}-000000000001`,
          items: [{ term: 'resilient', meaningZh: '有韧性的' }],
          freeLimit: 3,
          generationDeadlineMs: 120_000,
        });
        const job = await claimNextJob(
          db,
          `${label}-worker`,
          // Keep earlier failed scenarios leased until this multi-scenario test ends.
          180_000,
          ['practice_generation'],
        );
        expect(job?.resourceId).toBe(created.practiceId);
        return { practiceId: created.practiceId, job: job! };
      };

      const unsafeInput = await createClaim('unsafe-input');
      const unsafeInputProvider = new FakeAiProvider();
      vi.spyOn(unsafeInputProvider, 'moderate').mockResolvedValue({
        riskLevel: 'medium',
        flagged: false,
      });
      const generateUnsafe = vi.spyOn(unsafeInputProvider, 'generatePractice');
      const unsafeError = await captureAppError(
        handlePracticeGeneration(
          { db, provider: unsafeInputProvider, modelName: 'fake' },
          unsafeInput.job,
          { signal: new AbortController().signal },
        ),
      );
      expect(unsafeError).toMatchObject({
        code: 'AI_CONTENT_REJECTED',
        retryable: false,
      });
      expect(generateUnsafe).not.toHaveBeenCalled();
      await failPracticeGeneration(
        { db },
        unsafeInput.job,
        unsafeError,
        { signal: new AbortController().signal },
      );
      const [failedPractice] = await db
        .select({
          status: practiceSessions.status,
          failureCode: practiceSessions.failureCode,
          failureMessage: practiceSessions.failureMessagePublic,
        })
        .from(practiceSessions)
        .where(eq(practiceSessions.id, unsafeInput.practiceId));
      expect(failedPractice).toMatchObject({
        status: 'failed',
        failureCode: 'AI_CONTENT_REJECTED',
      });
      expect(failedPractice?.failureMessage).not.toContain('medium');
      expect(
        await db
          .select({ kind: usageLedger.kind })
          .from(usageLedger)
          .where(eq(usageLedger.practiceSessionId, unsafeInput.practiceId)),
      ).toEqual(expect.arrayContaining([{ kind: 'reserve' }, { kind: 'release' }]));

      const rejectedVerification = await createClaim('verify-reject');
      const rejectedProvider = new FakeAiProvider();
      vi.spyOn(rejectedProvider, 'verifyPractice').mockResolvedValue({
        approved: false,
        issues: ['supplier-only detail'],
      });
      await expect(
        handlePracticeGeneration(
          { db, provider: rejectedProvider, modelName: 'fake' },
          rejectedVerification.job,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT', retryable: true });
      expect(
        await practiceState(db, rejectedVerification.practiceId),
      ).toBe('validating');
      expect(
        await db
          .select()
          .from(practiceParagraphs)
          .where(
            eq(
              practiceParagraphs.practiceSessionId,
              rejectedVerification.practiceId,
            ),
          ),
      ).toHaveLength(0);

      const flaggedOutput = await createClaim('flagged-output');
      const flaggedProvider = new FakeAiProvider();
      vi.spyOn(flaggedProvider, 'moderate')
        .mockResolvedValueOnce({ riskLevel: 'low', flagged: false })
        .mockResolvedValueOnce({ riskLevel: 'low', flagged: true });
      await expect(
        handlePracticeGeneration(
          { db, provider: flaggedProvider, modelName: 'fake' },
          flaggedOutput.job,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({
        code: 'AI_CONTENT_REJECTED',
        retryable: true,
      });
      expect(await practiceState(db, flaggedOutput.practiceId)).toBe('validating');

      const expired = await createClaim('expired-before-ai');
      const expiredProvider = new FakeAiProvider();
      const moderateExpired = vi.spyOn(expiredProvider, 'moderate');
      await expect(
        handlePracticeGeneration(
          { db, provider: expiredProvider, modelName: 'fake' },
          { ...expired.job, deadlineAt: new Date(Date.now() - 1) },
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({
        code: 'GENERATION_DEADLINE_EXCEEDED',
        retryable: false,
      });
      expect(moderateExpired).not.toHaveBeenCalled();

      const leaseLoss = await createClaim('lease-loss');
      const leaseLossProvider = new FakeAiProvider();
      vi.spyOn(leaseLossProvider, 'moderate')
        .mockResolvedValueOnce({ riskLevel: 'low', flagged: false })
        .mockImplementationOnce(async () => {
          await db
            .update(jobs)
            .set({ lockedBy: 'replacement-worker' })
            .where(eq(jobs.id, leaseLoss.job.id));
          return { riskLevel: 'low', flagged: false };
        });
      await expect(
        handlePracticeGeneration(
          { db, provider: leaseLossProvider, modelName: 'fake' },
          leaseLoss.job,
          { signal: new AbortController().signal },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(await practiceState(db, leaseLoss.practiceId)).toBe('validating');
      expect(
        await db
          .select()
          .from(practiceParagraphs)
          .where(eq(practiceParagraphs.practiceSessionId, leaseLoss.practiceId)),
      ).toHaveLength(0);
    });
  }, 120_000);
});

async function captureAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
    throw new Error('Expected an AppError');
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return error;
  }
}

async function practiceState(
  db: Parameters<typeof createPractice>[0],
  practiceId: string,
) {
  const [practice] = await db
    .select({ status: practiceSessions.status })
    .from(practiceSessions)
    .where(eq(practiceSessions.id, practiceId));
  return practice?.status;
}

import { randomUUID } from 'node:crypto';

import { PracticeTopicSchema, type PracticeStatus } from '@context-reader/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';

import { AppError, type ErrorCode } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  jobs,
  practiceParagraphs,
  practiceQuestions,
  practiceSessions,
  practiceTargets,
  vocabularyItems,
  type OptionExplanations,
  type QuestionOption,
} from '../../db/schema';
import type {
  AiProvider,
  GeneratePracticeInput,
  ModerationResult,
} from '../../infrastructure/ai/types';
import type { ClaimedJob } from '../jobs/types';
import { commitQuota, releaseQuota } from '../quota/service';
import {
  validateGeneratedPractice,
  type GenerationTarget,
  type ValidatedGeneratedPractice,
} from './generation-validator';
import { assertPracticeTransition } from './state';

const DEFAULT_PROMPT_VERSION = 'ielts-generation-english-cloze-v3';
const successfulTerminalStatuses = new Set<PracticeStatus>([
  'ready',
  'in_progress',
  'completed',
]);

export interface PracticeGenerationDependencies {
  db: AppDatabase;
  provider: AiProvider;
  modelName: string;
  promptVersion?: string;
}

interface LoadedGenerationInput {
  status: PracticeStatus;
  providerInput: GeneratePracticeInput;
  validationTargets: GenerationTarget[];
}

export async function handlePracticeGeneration(
  dependencies: PracticeGenerationDependencies,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void> {
  const loaded = await loadGenerationInput(dependencies.db, job.resourceId);
  if (successfulTerminalStatuses.has(loaded.status)) return;
  if (loaded.status === 'failed') throw stateConflict();

  assertProviderCallAllowed(job, context.signal);
  const inputModeration = await dependencies.provider.moderate(
    JSON.stringify(loaded.providerInput),
    context.signal,
  );
  assertModerationAccepted(inputModeration, false);

  if (!(await moveToGenerating(dependencies.db, job, context.signal))) return;

  assertProviderCallAllowed(job, context.signal);
  const generated = await dependencies.provider.generatePractice(
    loaded.providerInput,
    context.signal,
  );
  const validated = validateGeneratedPractice(
    generated,
    loaded.validationTargets,
    loaded.providerInput.topic ? 'short' : 'long',
  );

  if (!(await moveToValidating(dependencies.db, job, context.signal))) return;

  assertProviderCallAllowed(job, context.signal);
  const verification = await dependencies.provider.verifyPractice(
    { ...loaded.providerInput, generated },
    context.signal,
  );
  if (!verification.approved) throw invalidGeneratedContent();

  assertProviderCallAllowed(job, context.signal);
  const outputModeration = await dependencies.provider.moderate(
    serializeVisibleContent(generated),
    context.signal,
  );
  assertModerationAccepted(outputModeration, true);

  assertWithinDeadline(job, context.signal);
  await persistGeneratedPractice(
    dependencies,
    job,
    validated,
    context.signal,
  );
}

export async function failPracticeGeneration(
  dependencies: Pick<PracticeGenerationDependencies, 'db'>,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  context.signal.throwIfAborted();
  const failure = publicGenerationFailure(error);

  await dependencies.db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockPracticeStatus(tx, job.resourceId);
    if (successfulTerminalStatuses.has(status)) return;
    if (status !== 'failed') {
      assertPracticeTransition(status, 'failed');
      const [updated] = await tx
        .update(practiceSessions)
        .set({
          status: 'failed',
          failureCode: failure.code,
          failureMessagePublic: failure.message,
        })
        .where(eq(practiceSessions.id, job.resourceId))
        .returning({ id: practiceSessions.id });
      if (!updated) throw stateConflict();
    }
    await settleGenerationQuota(tx, job.resourceId);
  });
}

async function loadGenerationInput(
  db: AppDatabase,
  practiceId: string,
): Promise<LoadedGenerationInput> {
  const [practice] = await db
    .select({ status: practiceSessions.status, examPath: practiceSessions.examPath, topic: practiceSessions.topic })
    .from(practiceSessions)
    .where(eq(practiceSessions.id, practiceId))
    .limit(1);
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  if (successfulTerminalStatuses.has(practice.status)) {
    return {
      status: practice.status,
      providerInput: { examPath: practice.examPath, targets: [] },
      validationTargets: [],
    };
  }

  const targets = await db
    .select({
      id: practiceTargets.id,
      term: vocabularyItems.term,
      meaningZh: vocabularyItems.meaningZh,
      sourceSentence: vocabularyItems.sourceSentence,
    })
    .from(practiceTargets)
    .innerJoin(
      vocabularyItems,
      eq(vocabularyItems.id, practiceTargets.vocabularyItemId),
    )
    .where(eq(practiceTargets.practiceSessionId, practiceId))
    .orderBy(asc(practiceTargets.position));
  if (targets.length === 0) {
    throw new AppError('INTERNAL_ERROR', '练习目标不存在', 500, true);
  }

  return {
    status: practice.status,
    providerInput: {
      examPath: practice.examPath,
      ...(practice.topic ? { topic: PracticeTopicSchema.parse(practice.topic) } : {}),
      targets: targets.map((target, index) => ({
        alias: `t${index + 1}`,
        term: target.term,
        meaningZh: target.meaningZh,
        ...(target.sourceSentence === null
          ? {}
          : { sourceSentence: target.sourceSentence }),
      })),
    },
    validationTargets: targets.map((target, index) => ({
      id: target.id,
      alias: `t${index + 1}`,
      meaningZh: target.meaningZh,
    })),
  };
}

async function moveToGenerating(
  db: AppDatabase,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockPracticeStatus(tx, job.resourceId);
    if (successfulTerminalStatuses.has(status)) return false;
    if (status === 'generating') return true;
    assertPracticeTransition(status, 'generating');
    await setPracticeStatus(tx, job.resourceId, 'generating');
    return true;
  });
}

async function moveToValidating(
  db: AppDatabase,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockPracticeStatus(tx, job.resourceId);
    if (successfulTerminalStatuses.has(status)) return false;
    if (status === 'validating') return true;
    assertPracticeTransition(status, 'validating');
    await setPracticeStatus(tx, job.resourceId, 'validating');
    return true;
  });
}

async function persistGeneratedPractice(
  dependencies: PracticeGenerationDependencies,
  job: ClaimedJob,
  generated: ValidatedGeneratedPractice,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await dependencies.db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockPracticeStatus(tx, job.resourceId);
    if (successfulTerminalStatuses.has(status)) return;
    assertPracticeTransition(status, 'ready');

    const paragraphIdsByKey = new Map<string, string>();
    await tx.insert(practiceParagraphs).values(
      generated.paragraphs.map((paragraph, position) => {
        const id = randomUUID();
        paragraphIdsByKey.set(paragraph.key, id);
        return {
          id,
          practiceSessionId: job.resourceId,
          position,
          plainText: paragraph.text,
        };
      }),
    );

    for (const usage of generated.usages) {
      const paragraphId = paragraphIdsByKey.get(usage.paragraphKey);
      if (!paragraphId) throw invalidGeneratedContent();
      const [updated] = await tx
        .update(practiceTargets)
        .set({
          paragraphId,
          surfaceForm: usage.surfaceForm,
          startOffset: usage.startOffset,
          endOffset: usage.endOffset,
        })
        .where(
          and(
            eq(practiceTargets.id, usage.targetId),
            eq(practiceTargets.practiceSessionId, job.resourceId),
          ),
        )
        .returning({ id: practiceTargets.id });
      if (!updated) throw invalidGeneratedContent();
    }

    await tx.insert(practiceQuestions).values(
      generated.questions.map((question) => {
        const options: QuestionOption[] = question.optionsEn.map((label) => ({
          id: randomUUID(),
          label,
        }));
        const correctOptionId = options[question.correctOptionIndex]?.id;
        if (!correctOptionId) throw invalidGeneratedContent();
        const optionExplanations: OptionExplanations = Object.fromEntries(
          options.map((option, index) => [
            option.id,
            question.optionExplanationsEn[index]!,
          ]),
        );
        return {
          id: randomUUID(),
          practiceTargetId: question.targetId,
          prompt: question.prompt,
          optionsJson: options,
          correctOptionId,
          meaningEn: question.meaningEn,
          // Keep the legacy storage column compatible with historical answers.
          explanationZh: question.explanationEn,
          optionExplanationsJson: optionExplanations,
        };
      }),
    );

    const [updated] = await tx
      .update(practiceSessions)
      .set({
        status: 'ready',
        articleTitle: generated.title,
        articleWordCount: generated.wordCount,
        modelName: dependencies.modelName,
        promptVersion: dependencies.promptVersion ?? (generated.wordCount <= 300 ? 'ielts-topic-short-english-cloze-v3' : DEFAULT_PROMPT_VERSION),
        failureCode: null,
        failureMessagePublic: null,
        readyAt: new Date(),
      })
      .where(eq(practiceSessions.id, job.resourceId))
      .returning({ id: practiceSessions.id });
    if (!updated) throw stateConflict();
    await settleGenerationQuota(tx, job.resourceId);
  });
}

async function requireActiveLease(
  tx: AppTransaction,
  job: ClaimedJob,
): Promise<void> {
  const [lease] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.resourceId, job.resourceId),
        eq(jobs.kind, 'practice_generation'),
        eq(jobs.status, 'running'),
        eq(jobs.lockedBy, job.lockedBy),
        sql`${jobs.leaseExpiresAt} > now()`,
      ),
    )
    .for('update')
    .limit(1);
  if (!lease) throw leaseLost();
}

async function lockPracticeStatus(
  tx: AppTransaction,
  practiceId: string,
): Promise<PracticeStatus> {
  // Always lock the group root first, including when this member is the root.
  // This also serializes terminal writes so the last member can settle quota.
  const [member] = await tx.select({ groupId: practiceSessions.topicGroupId })
    .from(practiceSessions).where(eq(practiceSessions.id, practiceId)).limit(1);
  if (member?.groupId) {
    await tx.select({ id: practiceSessions.id }).from(practiceSessions)
      .where(eq(practiceSessions.id, member.groupId)).for('update');
  }
  const [practice] = await tx
    .select({ status: practiceSessions.status })
    .from(practiceSessions)
    .where(eq(practiceSessions.id, practiceId))
    .for('update')
    .limit(1);
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  return practice.status;
}

async function setPracticeStatus(
  tx: AppTransaction,
  practiceId: string,
  status: PracticeStatus,
): Promise<void> {
  const [updated] = await tx
    .update(practiceSessions)
    .set({ status })
    .where(eq(practiceSessions.id, practiceId))
    .returning({ id: practiceSessions.id });
  if (!updated) throw stateConflict();
}

function assertProviderCallAllowed(job: ClaimedJob, signal: AbortSignal): void {
  assertWithinDeadline(job, signal);
}

function assertWithinDeadline(job: ClaimedJob, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= job.deadlineAt.getTime()) {
    throw new AppError(
      'GENERATION_DEADLINE_EXCEEDED',
      '练习生成已超过截止时间',
      504,
    );
  }
}

function assertModerationAccepted(
  result: ModerationResult,
  retryable: boolean,
): void {
  if (result.riskLevel !== 'low' || result.flagged) {
    throw new AppError(
      'AI_CONTENT_REJECTED',
      retryable ? '生成内容未通过安全检查' : '输入内容不适合生成练习',
      422,
      retryable,
    );
  }
}

function serializeVisibleContent(
  generated: ValidatedGeneratedPractice | Parameters<typeof validateGeneratedPractice>[0],
): string {
  return JSON.stringify({
    title: generated.title,
    paragraphs: generated.paragraphs,
    ...('questions' in generated ? { questions: generated.questions } : {}),
  });
}

function publicGenerationFailure(error: AppError): {
  code: ErrorCode;
  message: string;
} {
  switch (error.code) {
    case 'AI_CONTENT_REJECTED':
      return { code: error.code, message: '内容未通过安全检查，请调整输入后重试' };
    case 'GENERATION_DEADLINE_EXCEEDED':
      return { code: error.code, message: '练习生成超时，请重新提交' };
    case 'AI_INVALID_OUTPUT':
      return { code: error.code, message: '生成内容未通过质量检查，请重试' };
    case 'AI_UNAVAILABLE':
      return { code: error.code, message: 'AI 服务暂时不可用，请稍后重试' };
    default:
      return { code: 'INTERNAL_ERROR', message: '练习暂时无法生成，请稍后重试' };
  }
}

function invalidGeneratedContent(): AppError {
  return new AppError('AI_INVALID_OUTPUT', '生成内容未通过质量检查', 502, true);
}

function stateConflict(): AppError {
  return new AppError('STATE_CONFLICT', '练习状态已变更', 409);
}

function leaseLost(): DOMException {
  return new DOMException('Job lease lost', 'AbortError');
}

// Caller holds the group-root lock acquired by lockPracticeStatus.
async function settleGenerationQuota(tx: AppTransaction, practiceId: string): Promise<void> {
  const [practice] = await tx.select().from(practiceSessions)
    .where(eq(practiceSessions.id, practiceId)).limit(1);
  if (!practice) throw stateConflict();
  const members = practice.topicGroupId
    ? await tx.select({ status: practiceSessions.status }).from(practiceSessions)
      .where(eq(practiceSessions.topicGroupId, practice.topicGroupId))
    : [practice];
  if (members.some(({ status }) => !successfulTerminalStatuses.has(status) && status !== 'failed')) return;
  const quotaId = practice.topicGroupId ?? practiceId;
  if (members.some(({ status }) => successfulTerminalStatuses.has(status))) {
    await commitQuota(tx, quotaId);
  } else {
    await releaseQuota(tx, quotaId);
  }
}

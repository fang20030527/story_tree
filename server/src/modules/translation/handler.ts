import { and, asc, eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  jobs,
  practiceParagraphs,
  translations,
} from '../../db/schema';
import type { AiProvider } from '../../infrastructure/ai/types';
import type { ClaimedJob } from '../jobs/types';
import {
  assertTranslationModerationAccepted,
  validateTranslationText,
} from './validation';

export { validateTranslationText } from './validation';

export interface TranslationHandlerDependencies {
  db: AppDatabase;
  provider: AiProvider;
}

interface LoadedTranslation {
  status: 'queued' | 'generating' | 'ready' | 'failed';
  sourceText: string;
}

export async function handleTranslation(
  dependencies: TranslationHandlerDependencies,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void> {
  const loaded = await loadTranslation(dependencies.db, job.resourceId);
  if (loaded.status === 'ready') return;
  if (loaded.status === 'failed') throw stateConflict();

  if (!(await moveToGenerating(dependencies.db, job, context.signal))) return;

  assertProviderCallAllowed(job, context.signal);
  const translatedText = validateTranslationText(
    await dependencies.provider.translate(loaded.sourceText, context.signal),
    loaded.sourceText,
  );

  assertProviderCallAllowed(job, context.signal);
  const moderation = await dependencies.provider.moderate(
    translatedText,
    context.signal,
  );
  assertTranslationModerationAccepted(moderation);

  assertWithinDeadline(job, context.signal);
  await persistReadyTranslation(
    dependencies.db,
    job,
    translatedText,
    context.signal,
  );
}

export async function failTranslation(
  dependencies: Pick<TranslationHandlerDependencies, 'db'>,
  job: ClaimedJob,
  _error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  context.signal.throwIfAborted();
  await dependencies.db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockTranslationStatus(tx, job.resourceId);
    if (status === 'ready' || status === 'failed') return;
    const [updated] = await tx
      .update(translations)
      .set({ status: 'failed', translatedTextZh: null, readyAt: null })
      .where(eq(translations.id, job.resourceId))
      .returning({ id: translations.id });
    if (!updated) throw stateConflict();
  });
}

async function loadTranslation(
  db: AppDatabase,
  translationId: string,
): Promise<LoadedTranslation> {
  const [translation] = await db
    .select({
      practiceId: translations.practiceSessionId,
      scope: translations.scope,
      paragraphId: translations.paragraphId,
      status: translations.status,
    })
    .from(translations)
    .where(eq(translations.id, translationId))
    .limit(1);
  if (!translation) throw new AppError('NOT_FOUND', '翻译不存在', 404);
  if (translation.status === 'ready' || translation.status === 'failed') {
    return { status: translation.status, sourceText: '' };
  }

  if (translation.scope === 'paragraph') {
    if (!translation.paragraphId) {
      throw new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
    }
    const [paragraph] = await db
      .select({ plainText: practiceParagraphs.plainText })
      .from(practiceParagraphs)
      .where(
        and(
          eq(practiceParagraphs.id, translation.paragraphId),
          eq(practiceParagraphs.practiceSessionId, translation.practiceId),
        ),
      )
      .limit(1);
    if (!paragraph) {
      throw new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
    }
    return { status: translation.status, sourceText: paragraph.plainText };
  }

  const paragraphs = await db
    .select({ plainText: practiceParagraphs.plainText })
    .from(practiceParagraphs)
    .where(eq(practiceParagraphs.practiceSessionId, translation.practiceId))
    .orderBy(asc(practiceParagraphs.position));
  if (paragraphs.length === 0) {
    throw new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
  }
  return {
    status: translation.status,
    sourceText: paragraphs.map(({ plainText }) => plainText).join('\n\n'),
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
    const status = await lockTranslationStatus(tx, job.resourceId);
    if (status === 'ready') return false;
    if (status === 'failed') throw stateConflict();
    if (status === 'generating') return true;
    const [updated] = await tx
      .update(translations)
      .set({ status: 'generating' })
      .where(eq(translations.id, job.resourceId))
      .returning({ id: translations.id });
    if (!updated) throw stateConflict();
    return true;
  });
}

async function persistReadyTranslation(
  db: AppDatabase,
  job: ClaimedJob,
  translatedText: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockTranslationStatus(tx, job.resourceId);
    if (status === 'ready') return;
    if (status === 'failed') throw stateConflict();
    const [updated] = await tx
      .update(translations)
      .set({
        status: 'ready',
        translatedTextZh: translatedText,
        readyAt: new Date(),
      })
      .where(eq(translations.id, job.resourceId))
      .returning({ id: translations.id });
    if (!updated) throw stateConflict();
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
        eq(jobs.kind, 'translation'),
        eq(jobs.status, 'running'),
        eq(jobs.lockedBy, job.lockedBy),
        sql`${jobs.leaseExpiresAt} > now()`,
      ),
    )
    .for('update')
    .limit(1);
  if (!lease) throw new DOMException('Job lease lost', 'AbortError');
}

async function lockTranslationStatus(
  tx: AppTransaction,
  translationId: string,
): Promise<'queued' | 'generating' | 'ready' | 'failed'> {
  const [translation] = await tx
    .select({ status: translations.status })
    .from(translations)
    .where(eq(translations.id, translationId))
    .for('update')
    .limit(1);
  if (!translation) throw new AppError('NOT_FOUND', '翻译不存在', 404);
  return translation.status;
}

function assertProviderCallAllowed(job: ClaimedJob, signal: AbortSignal): void {
  assertWithinDeadline(job, signal);
}

function assertWithinDeadline(job: ClaimedJob, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (Date.now() >= job.deadlineAt.getTime()) {
    throw new AppError(
      'GENERATION_DEADLINE_EXCEEDED',
      '翻译任务已超过截止时间',
      504,
    );
  }
}

function stateConflict(): AppError {
  return new AppError('STATE_CONFLICT', '翻译状态已变更', 409);
}

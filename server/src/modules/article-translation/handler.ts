import { and, asc, eq, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { articleParagraphs, articleTranslations, jobs } from '../../db/schema';
import type { AiProvider } from '../../infrastructure/ai/types';
import type { ClaimedJob } from '../jobs/types';
import {
  assertTranslationModerationAccepted,
  validateTranslationText,
} from '../translation/validation';

export interface ArticleTranslationHandlerDependencies {
  db: AppDatabase;
  provider: AiProvider;
}

interface LoadedArticleTranslation {
  status: 'queued' | 'generating' | 'ready' | 'failed';
  sourceText: string;
}

export async function handleArticleTranslation(
  dependencies: ArticleTranslationHandlerDependencies,
  job: ClaimedJob,
  context: { signal: AbortSignal },
): Promise<void> {
  const loaded = await loadArticleTranslation(dependencies.db, job.resourceId);
  if (loaded.status === 'ready') return;
  if (loaded.status === 'failed') throw stateConflict();
  if (!(await moveToGenerating(dependencies.db, job, context.signal))) return;

  assertWithinDeadline(job, context.signal);
  const translatedText = validateTranslationText(
    await dependencies.provider.translate(loaded.sourceText, context.signal),
    loaded.sourceText,
  );
  assertWithinDeadline(job, context.signal);
  const moderation = await dependencies.provider.moderate(
    translatedText,
    context.signal,
  );
  assertTranslationModerationAccepted(moderation);
  assertWithinDeadline(job, context.signal);
  await persistReady(dependencies.db, job, translatedText, context.signal);
}

export async function failArticleTranslation(
  dependencies: Pick<ArticleTranslationHandlerDependencies, 'db'>,
  job: ClaimedJob,
  error: AppError,
  context: { signal: AbortSignal },
): Promise<void> {
  context.signal.throwIfAborted();
  await dependencies.db.transaction(async (tx) => {
    await requireActiveLease(tx, job);
    const status = await lockTranslationStatus(tx, job.resourceId);
    if (status === 'ready' || status === 'failed') return;
    const [updated] = await tx
      .update(articleTranslations)
      .set({
        status: 'failed',
        translatedTextZh: null,
        failureCode: error.code,
        failureMessagePublic: '翻译暂时无法完成',
        readyAt: null,
      })
      .where(eq(articleTranslations.id, job.resourceId))
      .returning({ id: articleTranslations.id });
    if (!updated) throw stateConflict();
  });
}

async function loadArticleTranslation(
  db: AppDatabase,
  translationId: string,
): Promise<LoadedArticleTranslation> {
  const [translation] = await db
    .select({
      articleId: articleTranslations.articleId,
      scope: articleTranslations.scope,
      paragraphId: articleTranslations.paragraphId,
      status: articleTranslations.status,
    })
    .from(articleTranslations)
    .where(eq(articleTranslations.id, translationId))
    .limit(1);
  if (!translation) {
    throw new AppError('NOT_FOUND', '翻译不存在', 404);
  }
  if (translation.status === 'ready' || translation.status === 'failed') {
    return { status: translation.status, sourceText: '' };
  }

  if (translation.scope === 'paragraph') {
    if (!translation.paragraphId) {
      throw new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
    }
    const [paragraph] = await db
      .select({ plainText: articleParagraphs.plainText })
      .from(articleParagraphs)
      .where(
        and(
          eq(articleParagraphs.id, translation.paragraphId),
          eq(articleParagraphs.articleId, translation.articleId),
        ),
      )
      .limit(1);
    if (!paragraph) {
      throw new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
    }
    return { status: translation.status, sourceText: paragraph.plainText };
  }

  const paragraphs = await db
    .select({ plainText: articleParagraphs.plainText })
    .from(articleParagraphs)
    .where(eq(articleParagraphs.articleId, translation.articleId))
    .orderBy(asc(articleParagraphs.position));
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
      .update(articleTranslations)
      .set({ status: 'generating' })
      .where(eq(articleTranslations.id, job.resourceId))
      .returning({ id: articleTranslations.id });
    if (!updated) throw stateConflict();
    return true;
  });
}

async function persistReady(
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
      .update(articleTranslations)
      .set({
        status: 'ready',
        translatedTextZh: translatedText,
        failureCode: null,
        failureMessagePublic: null,
        readyAt: new Date(),
      })
      .where(eq(articleTranslations.id, job.resourceId))
      .returning({ id: articleTranslations.id });
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
        eq(jobs.kind, 'article_translation'),
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
    .select({ status: articleTranslations.status })
    .from(articleTranslations)
    .where(eq(articleTranslations.id, translationId))
    .for('update')
    .limit(1);
  if (!translation) {
    throw new AppError('NOT_FOUND', '翻译不存在', 404);
  }
  return translation.status;
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

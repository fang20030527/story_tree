import { randomUUID } from 'node:crypto';

import {
  ArticleTranslationDtoSchema,
  type ArticleTranslationDto,
  type TranslationRequest,
} from '@context-reader/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  articleParagraphs,
  articleTranslations,
  importedArticles,
  jobs,
} from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { createTranslationSourceHash } from '../translation/validation';

type ArticleTranslationRow = typeof articleTranslations.$inferSelect;

export interface RequestArticleTranslationInput {
  userId: string;
  articleId: string;
  request: TranslationRequest;
  idempotencyKey: string;
  deadlineMs: number;
}

export async function requestArticleTranslation(
  db: AppDatabase,
  input: RequestArticleTranslationInput,
): Promise<ArticleTranslationDto> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'request_article_translation',
      input.idempotencyKey,
      { articleId: input.articleId, ...input.request },
    );
    if (replay) {
      return serializeArticleTranslation(
        await findOwnedArticleTranslation(tx, input.userId, replay),
      );
    }

    const sourceText = await loadOwnedArticleSource(tx, input);
    const paragraphId =
      input.request.scope === 'paragraph' ? input.request.paragraphId : null;
    const sourceHash = createTranslationSourceHash(
      input.articleId,
      input.request.scope,
      paragraphId,
      sourceText,
    );
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sourceHash}))`);

    let translation = await findCachedArticleTranslation(
      tx,
      input.articleId,
      input.request,
      sourceHash,
    );
    if (!translation) {
      const [created] = await tx
        .insert(articleTranslations)
        .values({
          id: randomUUID(),
          articleId: input.articleId,
          scope: input.request.scope,
          paragraphId,
          sourceHash,
          status: 'queued',
        })
        .returning();
      if (!created) {
        throw new AppError('INTERNAL_ERROR', '翻译任务创建失败', 500, true);
      }
      translation = created;
      await createArticleTranslationJob(tx, created.id, input.deadlineMs);
    } else if (translation.status === 'failed') {
      if (await findActiveArticleTranslationJob(tx, translation.id)) {
        throw new AppError('STATE_CONFLICT', '翻译状态正在更新，请重试', 409, true);
      }
      const [reset] = await tx
        .update(articleTranslations)
        .set({
          status: 'queued',
          translatedTextZh: null,
          failureCode: null,
          failureMessagePublic: null,
          readyAt: null,
        })
        .where(eq(articleTranslations.id, translation.id))
        .returning();
      if (!reset) {
        throw new AppError('INTERNAL_ERROR', '翻译任务创建失败', 500, true);
      }
      translation = reset;
      await createArticleTranslationJob(tx, reset.id, input.deadlineMs);
    }

    await finishIdempotentOperation(
      tx,
      input.userId,
      'request_article_translation',
      input.idempotencyKey,
      translation.id,
    );
    return serializeArticleTranslation(translation);
  });
}

export async function getArticleTranslationForUser(
  db: AppDatabase,
  input: { userId: string; translationId: string },
): Promise<ArticleTranslationDto> {
  return serializeArticleTranslation(
    await findOwnedArticleTranslation(db, input.userId, input.translationId),
  );
}

async function loadOwnedArticleSource(
  tx: AppTransaction,
  input: RequestArticleTranslationInput,
): Promise<string> {
  const [article] = await tx
    .select({ id: importedArticles.id })
    .from(importedArticles)
    .where(
      and(
        eq(importedArticles.id, input.articleId),
        eq(importedArticles.userId, input.userId),
      ),
    )
    .limit(1);
  if (!article) {
    throw new AppError('NOT_FOUND', '文章不存在', 404);
  }

  if (input.request.scope === 'paragraph') {
    const [paragraph] = await tx
      .select({ plainText: articleParagraphs.plainText })
      .from(articleParagraphs)
      .where(
        and(
          eq(articleParagraphs.id, input.request.paragraphId),
          eq(articleParagraphs.articleId, article.id),
        ),
      )
      .limit(1);
    if (!paragraph) {
      throw new AppError('NOT_FOUND', '段落不存在', 404);
    }
    return paragraph.plainText;
  }

  const paragraphs = await tx
    .select({ plainText: articleParagraphs.plainText })
    .from(articleParagraphs)
    .where(eq(articleParagraphs.articleId, article.id))
    .orderBy(asc(articleParagraphs.position));
  if (paragraphs.length === 0) {
    throw new AppError('INTERNAL_ERROR', '翻译来源无效', 500, true);
  }
  return paragraphs.map(({ plainText }) => plainText).join('\n\n');
}

async function findOwnedArticleTranslation(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  translationId: string,
): Promise<ArticleTranslationRow> {
  const [translation] = await db
    .select({
      id: articleTranslations.id,
      articleId: articleTranslations.articleId,
      scope: articleTranslations.scope,
      paragraphId: articleTranslations.paragraphId,
      sourceHash: articleTranslations.sourceHash,
      status: articleTranslations.status,
      translatedTextZh: articleTranslations.translatedTextZh,
      failureCode: articleTranslations.failureCode,
      failureMessagePublic: articleTranslations.failureMessagePublic,
      createdAt: articleTranslations.createdAt,
      readyAt: articleTranslations.readyAt,
    })
    .from(articleTranslations)
    .innerJoin(
      importedArticles,
      eq(importedArticles.id, articleTranslations.articleId),
    )
    .where(
      and(
        eq(articleTranslations.id, translationId),
        eq(importedArticles.userId, userId),
      ),
    )
    .limit(1);
  if (!translation) {
    throw new AppError('NOT_FOUND', '翻译不存在', 404);
  }
  return translation;
}

async function findCachedArticleTranslation(
  tx: AppTransaction,
  articleId: string,
  request: TranslationRequest,
  sourceHash: string,
): Promise<ArticleTranslationRow | undefined> {
  const paragraphCondition =
    request.scope === 'paragraph'
      ? eq(articleTranslations.paragraphId, request.paragraphId)
      : isNull(articleTranslations.paragraphId);
  const [translation] = await tx
    .select()
    .from(articleTranslations)
    .where(
      and(
        eq(articleTranslations.articleId, articleId),
        eq(articleTranslations.scope, request.scope),
        paragraphCondition,
        eq(articleTranslations.sourceHash, sourceHash),
      ),
    )
    .limit(1);
  return translation;
}

async function findActiveArticleTranslationJob(
  tx: AppTransaction,
  translationId: string,
): Promise<string | undefined> {
  const [job] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'article_translation'),
        eq(jobs.resourceId, translationId),
        sql`${jobs.status} in ('queued', 'running')`,
      ),
    )
    .limit(1);
  return job?.id;
}

async function createArticleTranslationJob(
  tx: AppTransaction,
  translationId: string,
  deadlineMs: number,
): Promise<void> {
  await tx.insert(jobs).values({
    id: randomUUID(),
    kind: 'article_translation',
    resourceId: translationId,
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: new Date(),
    deadlineAt: new Date(Date.now() + deadlineMs),
  });
}

function serializeArticleTranslation(
  translation: ArticleTranslationRow,
): ArticleTranslationDto {
  const active =
    translation.status === 'queued' || translation.status === 'generating';
  if (translation.status === 'ready' && !translation.translatedTextZh) {
    throw new AppError('INTERNAL_ERROR', '翻译内容暂时无法读取', 500, true);
  }
  return ArticleTranslationDtoSchema.parse({
    id: translation.id,
    status: translation.status,
    scope: translation.scope,
    paragraphId: translation.paragraphId,
    translatedTextZh:
      translation.status === 'ready' ? translation.translatedTextZh : null,
    ...(active ? { pollAfterMs: 1_500 } : {}),
    failure:
      translation.status === 'failed'
        ? {
            code: translation.failureCode,
            message: translation.failureMessagePublic,
            retryable: true,
          }
        : null,
  });
}

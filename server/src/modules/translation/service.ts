import { randomUUID } from 'node:crypto';

import {
  TranslationDtoSchema,
  type TranslationDto,
  type TranslationRequest,
} from '@context-reader/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  jobs,
  practiceParagraphs,
  practiceSessions,
  translations,
} from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { createTranslationSourceHash } from './validation';

type TranslationRow = typeof translations.$inferSelect;

export interface RequestTranslationInput {
  userId: string;
  practiceId: string;
  request: TranslationRequest;
  idempotencyKey: string;
  deadlineMs: number;
}

export async function requestTranslation(
  db: AppDatabase,
  input: RequestTranslationInput,
): Promise<TranslationDto> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'request_translation',
      input.idempotencyKey,
      { practiceId: input.practiceId, ...input.request },
    );
    if (replay) {
      return serializeTranslation(
        await findOwnedTranslation(tx, input.userId, replay),
      );
    }

    const source = await loadOwnedSource(tx, input);
    const sourceHash = createTranslationSourceHash(
      input.practiceId,
      input.request.scope,
      input.request.scope === 'paragraph' ? input.request.paragraphId : null,
      source,
    );
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sourceHash}))`);

    let translation = await findCachedTranslation(
      tx,
      input.practiceId,
      input.request,
      sourceHash,
    );
    if (!translation) {
      const [created] = await tx
        .insert(translations)
        .values({
          id: randomUUID(),
          practiceSessionId: input.practiceId,
          scope: input.request.scope,
          paragraphId:
            input.request.scope === 'paragraph'
              ? input.request.paragraphId
              : null,
          sourceHash,
          status: 'queued',
        })
        .returning();
      if (!created) {
        throw new AppError('INTERNAL_ERROR', '翻译任务创建失败', 500, true);
      }
      translation = created;
      await createTranslationJob(tx, created.id, input.deadlineMs);
    } else if (translation.status === 'failed') {
      const activeJob = await findActiveTranslationJob(tx, translation.id);
      if (activeJob) {
        throw new AppError('STATE_CONFLICT', '翻译状态正在更新，请重试', 409, true);
      }
      const [reset] = await tx
        .update(translations)
        .set({ status: 'queued', translatedTextZh: null, readyAt: null })
        .where(eq(translations.id, translation.id))
        .returning();
      if (!reset) {
        throw new AppError('INTERNAL_ERROR', '翻译任务创建失败', 500, true);
      }
      translation = reset;
      await createTranslationJob(tx, reset.id, input.deadlineMs);
    }

    await finishIdempotentOperation(
      tx,
      input.userId,
      'request_translation',
      input.idempotencyKey,
      translation.id,
    );
    return serializeTranslation(translation);
  });
}

export async function getTranslationForUser(
  db: AppDatabase,
  input: { userId: string; translationId: string },
): Promise<TranslationDto> {
  return serializeTranslation(
    await findOwnedTranslation(db, input.userId, input.translationId),
  );
}

async function loadOwnedSource(
  tx: AppTransaction,
  input: RequestTranslationInput,
): Promise<string> {
  const [practice] = await tx
    .select({ status: practiceSessions.status })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.id, input.practiceId),
        eq(practiceSessions.userId, input.userId),
      ),
    )
    .limit(1);
  if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
  if (
    practice.status !== 'ready' &&
    practice.status !== 'in_progress' &&
    practice.status !== 'completed'
  ) {
    throw new AppError('STATE_CONFLICT', '练习尚未准备完成', 409, true);
  }

  if (input.request.scope === 'paragraph') {
    const [paragraph] = await tx
      .select({ plainText: practiceParagraphs.plainText })
      .from(practiceParagraphs)
      .where(
        and(
          eq(practiceParagraphs.id, input.request.paragraphId),
          eq(practiceParagraphs.practiceSessionId, input.practiceId),
        ),
      )
      .limit(1);
    if (!paragraph) throw new AppError('NOT_FOUND', '段落不存在', 404);
    return paragraph.plainText;
  }

  const paragraphs = await tx
    .select({ plainText: practiceParagraphs.plainText })
    .from(practiceParagraphs)
    .where(eq(practiceParagraphs.practiceSessionId, input.practiceId))
    .orderBy(asc(practiceParagraphs.position));
  if (paragraphs.length === 0) {
    throw new AppError('INTERNAL_ERROR', '练习正文不存在', 500, true);
  }
  return paragraphs.map(({ plainText }) => plainText).join('\n\n');
}

async function findOwnedTranslation(
  db: Pick<AppDatabase, 'select'>,
  userId: string,
  translationId: string,
): Promise<TranslationRow> {
  const [translation] = await db
    .select({
      id: translations.id,
      practiceSessionId: translations.practiceSessionId,
      scope: translations.scope,
      paragraphId: translations.paragraphId,
      sourceHash: translations.sourceHash,
      status: translations.status,
      translatedTextZh: translations.translatedTextZh,
      createdAt: translations.createdAt,
      readyAt: translations.readyAt,
    })
    .from(translations)
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, translations.practiceSessionId),
    )
    .where(
      and(
        eq(translations.id, translationId),
        eq(practiceSessions.userId, userId),
      ),
    )
    .limit(1);
  if (!translation) throw new AppError('NOT_FOUND', '翻译不存在', 404);
  return translation;
}

async function findCachedTranslation(
  tx: AppTransaction,
  practiceId: string,
  request: TranslationRequest,
  sourceHash: string,
): Promise<TranslationRow | undefined> {
  const paragraphCondition =
    request.scope === 'paragraph'
      ? eq(translations.paragraphId, request.paragraphId)
      : isNull(translations.paragraphId);
  const [translation] = await tx
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.practiceSessionId, practiceId),
        eq(translations.scope, request.scope),
        paragraphCondition,
        eq(translations.sourceHash, sourceHash),
      ),
    )
    .limit(1);
  return translation;
}

async function findActiveTranslationJob(
  tx: AppTransaction,
  translationId: string,
): Promise<string | undefined> {
  const [job] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, 'translation'),
        eq(jobs.resourceId, translationId),
        sql`${jobs.status} in ('queued', 'running')`,
      ),
    )
    .limit(1);
  return job?.id;
}

async function createTranslationJob(
  tx: AppTransaction,
  translationId: string,
  deadlineMs: number,
): Promise<void> {
  await tx.insert(jobs).values({
    id: randomUUID(),
    kind: 'translation',
    resourceId: translationId,
    status: 'queued',
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: new Date(),
    deadlineAt: new Date(Date.now() + deadlineMs),
  });
}

function serializeTranslation(translation: TranslationRow): TranslationDto {
  const active =
    translation.status === 'queued' || translation.status === 'generating';
  if (translation.status === 'ready' && !translation.translatedTextZh) {
    throw new AppError('INTERNAL_ERROR', '翻译内容暂时无法读取', 500, true);
  }
  return TranslationDtoSchema.parse({
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
            code: 'AI_UNAVAILABLE',
            message: '翻译暂时无法完成',
            retryable: true,
          }
        : null,
  });
}

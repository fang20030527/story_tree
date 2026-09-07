import { randomUUID } from 'node:crypto';

import {
  AssistanceResponseSchema,
  type AssistanceRequest,
  type AssistanceResponse,
} from '@context-reader/contracts';
import { and, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import {
  assistanceEvents,
  practiceParagraphs,
  practiceSessions,
  practiceTargets,
  vocabularyItems,
} from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { assertPracticeTransition } from './state';

export interface RecordAssistanceInput {
  userId: string;
  practiceId: string;
  request: AssistanceRequest;
  idempotencyKey: string;
}

interface AssistanceReferences {
  practiceTargetId: string | null;
  paragraphId: string | null;
  hintMeaningZh: string | null;
}

export async function recordAssistance(
  db: AppDatabase,
  input: RecordAssistanceInput,
): Promise<AssistanceResponse> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'record_assistance',
      input.idempotencyKey,
      { practiceId: input.practiceId, ...input.request },
    );
    if (replay) {
      return loadAssistanceResponse(
        tx,
        input.userId,
        input.practiceId,
        replay,
      );
    }

    const [practice] = await tx
      .select({
        status: practiceSessions.status,
        startedAt: practiceSessions.startedAt,
      })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.id, input.practiceId),
          eq(practiceSessions.userId, input.userId),
        ),
      )
      .for('update')
      .limit(1);
    if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);
    if (
      practice.status !== 'ready' &&
      practice.status !== 'in_progress' &&
      practice.status !== 'completed'
    ) {
      throw new AppError('STATE_CONFLICT', '练习尚不能记录辅助', 409);
    }

    const references = await resolveAssistanceReferences(
      tx,
      input.practiceId,
      input.request,
    );
    const assistanceId = randomUUID();
    const shownAt = new Date();
    await tx.insert(assistanceEvents).values({
      id: assistanceId,
      practiceSessionId: input.practiceId,
      userId: input.userId,
      kind: input.request.kind,
      practiceTargetId: references.practiceTargetId,
      paragraphId: references.paragraphId,
      idempotencyKey: input.idempotencyKey,
      shownAt,
    });

    if (practice.status === 'ready') {
      assertPracticeTransition('ready', 'in_progress');
      await tx
        .update(practiceSessions)
        .set({ status: 'in_progress', startedAt: practice.startedAt ?? shownAt })
        .where(eq(practiceSessions.id, input.practiceId));
    }
    await finishIdempotentOperation(
      tx,
      input.userId,
      'record_assistance',
      input.idempotencyKey,
      assistanceId,
    );
    return AssistanceResponseSchema.parse({
      recorded: true,
      hintMeaningZh: references.hintMeaningZh,
    });
  });
}

async function resolveAssistanceReferences(
  tx: AppTransaction,
  practiceId: string,
  request: AssistanceRequest,
): Promise<AssistanceReferences> {
  if (request.kind === 'word_hint') {
    const [target] = await tx
      .select({
        id: practiceTargets.id,
        meaningZh: vocabularyItems.meaningZh,
      })
      .from(practiceTargets)
      .innerJoin(
        vocabularyItems,
        eq(vocabularyItems.id, practiceTargets.vocabularyItemId),
      )
      .where(
        and(
          eq(practiceTargets.id, request.targetId),
          eq(practiceTargets.practiceSessionId, practiceId),
        ),
      )
      .limit(1);
    if (!target) throw new AppError('NOT_FOUND', '目标词不存在', 404);
    return {
      practiceTargetId: target.id,
      paragraphId: null,
      hintMeaningZh: target.meaningZh,
    };
  }

  if (request.kind === 'paragraph_translation') {
    const [paragraph] = await tx
      .select({ id: practiceParagraphs.id })
      .from(practiceParagraphs)
      .where(
        and(
          eq(practiceParagraphs.id, request.paragraphId),
          eq(practiceParagraphs.practiceSessionId, practiceId),
        ),
      )
      .limit(1);
    if (!paragraph) throw new AppError('NOT_FOUND', '段落不存在', 404);
    return {
      practiceTargetId: null,
      paragraphId: paragraph.id,
      hintMeaningZh: null,
    };
  }

  return {
    practiceTargetId: null,
    paragraphId: null,
    hintMeaningZh: null,
  };
}

async function loadAssistanceResponse(
  tx: AppTransaction,
  userId: string,
  practiceId: string,
  assistanceId: string,
): Promise<AssistanceResponse> {
  const [event] = await tx
    .select({
      kind: assistanceEvents.kind,
      practiceTargetId: assistanceEvents.practiceTargetId,
    })
    .from(assistanceEvents)
    .where(
      and(
        eq(assistanceEvents.id, assistanceId),
        eq(assistanceEvents.userId, userId),
        eq(assistanceEvents.practiceSessionId, practiceId),
      ),
    )
    .limit(1);
  if (!event) throw new AppError('NOT_FOUND', '辅助记录不存在', 404);

  let hintMeaningZh: string | null = null;
  if (event.kind === 'word_hint') {
    if (!event.practiceTargetId) {
      throw new AppError('INTERNAL_ERROR', '辅助记录暂时无法读取', 500, true);
    }
    const [target] = await tx
      .select({ meaningZh: vocabularyItems.meaningZh })
      .from(practiceTargets)
      .innerJoin(
        vocabularyItems,
        eq(vocabularyItems.id, practiceTargets.vocabularyItemId),
      )
      .where(eq(practiceTargets.id, event.practiceTargetId))
      .limit(1);
    if (!target) {
      throw new AppError('INTERNAL_ERROR', '辅助记录暂时无法读取', 500, true);
    }
    hintMeaningZh = target.meaningZh;
  }
  return AssistanceResponseSchema.parse({ recorded: true, hintMeaningZh });
}

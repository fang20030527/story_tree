import { randomInt, randomUUID } from 'node:crypto';

import { PracticeTopicSchema, type PracticeStatus, type VocabularyInput } from '@context-reader/contracts';
import { and, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { jobs, practiceSessions, practiceTargets } from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { getRemainingQuota, reserveQuota } from '../quota/service';
import { normalizeTerm, rejectDuplicateInputs } from '../vocabulary/normalize';
import {
  upsertExactVocabularyItems,
} from '../vocabulary/repository';
import { selectReviewVocabularyItemIds } from '../vocabulary/word-state';

export interface CreatedPractice {
  practiceId: string;
  status: PracticeStatus;
  remainingFreePractices: number;
  pollAfterMs?: 1_500;
}

export async function createPractice(
  db: AppDatabase,
  input: {
    userId: string;
    idempotencyKey: string;
    items: VocabularyInput[];
    freeLimit: number;
    generationDeadlineMs: number;
    format?: 'topic_set';
  },
): Promise<CreatedPractice> {
  rejectDuplicateInputs(input.items);
  return createPracticeWithTargetResolver(db, {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestMaterial: input.format ? { items: input.items, format: input.format } : input.items,
    freeLimit: input.freeLimit,
    generationDeadlineMs: input.generationDeadlineMs,
    ...(input.format ? { format: input.format } : {}),
    resolveTargetIds: async (tx) => {
      const ids = await upsertExactVocabularyItems(tx, input.userId, input.items);
      const seen = new Set<string>();
      return ids.filter((_id, index) => {
        const term = normalizeTerm(input.items[index]!.term);
        if (seen.has(term)) return false;
        seen.add(term);
        return true;
      });
    },
  });
}

export async function createPracticeFromVocabulary(
  db: AppDatabase,
  input: {
    userId: string;
    idempotencyKey: string;
    targetCount: number;
    freeLimit: number;
    generationDeadlineMs: number;
    format?: 'topic_set';
  },
): Promise<CreatedPractice> {
  if (!Number.isSafeInteger(input.targetCount) || input.targetCount < 1) {
    throw new AppError('VALIDATION_ERROR', '练习数量必须是正整数', 400);
  }

  return createPracticeWithTargetResolver(db, {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestMaterial: {
      source: 'vocabulary',
      ...(input.format ? { format: input.format } : {}),
      targetCount: input.targetCount,
    },
    freeLimit: input.freeLimit,
    generationDeadlineMs: input.generationDeadlineMs,
    ...(input.format ? { format: input.format } : {}),
    resolveTargetIds: async (tx) => {
      const itemIds = await selectReviewVocabularyItemIds(
        tx,
        input.userId,
        input.targetCount,
      );
      if (itemIds.length === 0) {
        throw new AppError(
          'INSUFFICIENT_VOCABULARY',
          '当前没有待复习单词',
          422,
        );
      }
      return itemIds;
    },
  });
}

interface TargetResolverInput {
  userId: string;
  idempotencyKey: string;
  requestMaterial: unknown;
  freeLimit: number;
  generationDeadlineMs: number;
  format?: 'topic_set';
  resolveTargetIds: (tx: AppTransaction) => Promise<string[]>;
}

async function createPracticeWithTargetResolver(
  db: AppDatabase,
  input: TargetResolverInput,
): Promise<CreatedPractice> {
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'create_practice',
      input.idempotencyKey,
      input.requestMaterial,
    );
    if (replay) {
      const [practice] = await tx
        .select({ status: practiceSessions.status })
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.id, replay),
            eq(practiceSessions.userId, input.userId),
          ),
        )
        .limit(1);
      if (!practice) throw new AppError('NOT_FOUND', '练习不存在', 404);

      const remainingFreePractices = await getRemainingQuota(
        tx,
        input.userId,
        input.freeLimit,
      );
      return {
        practiceId: replay,
        status: practice.status,
        remainingFreePractices,
        ...(isPending(practice.status) ? { pollAfterMs: 1_500 as const } : {}),
      };
    }

    const practiceId = randomUUID();
    const topics = [...PracticeTopicSchema.options];
    for (let index = topics.length - 1; index > 0; index -= 1) {
      const other = randomInt(index + 1);
      [topics[index], topics[other]] = [topics[other]!, topics[index]!];
    }
    const members = input.format === 'topic_set'
      ? topics.slice(0, 4).map((topic, position) => ({
          id: position === 0 ? practiceId : randomUUID(),
          topicGroupId: practiceId,
          topic,
          topicPosition: position,
        }))
      : [{ id: practiceId }];
    await tx.insert(practiceSessions).values(members.map((member) => ({
      ...member,
      userId: input.userId,
      examPath: 'ielts' as const,
      status: 'queued' as const,
    })));
    const remainingFreePractices = await reserveQuota(
      tx,
      input.userId,
      practiceId,
      input.freeLimit,
    );
    const itemIds = await input.resolveTargetIds(tx);
    await tx.insert(practiceTargets).values(
      members.flatMap((member) => itemIds.map((vocabularyItemId, position) => ({
        id: randomUUID(),
        practiceSessionId: member.id,
        vocabularyItemId,
        position,
      }))),
    );
    await tx.insert(jobs).values(members.map((member) => ({
      id: randomUUID(),
      kind: 'practice_generation' as const,
      resourceId: member.id,
      status: 'queued' as const,
      attemptCount: 0,
      maxAttempts: 3,
      availableAt: new Date(),
      deadlineAt: new Date(Date.now() + input.generationDeadlineMs * members.length),
    })));
    await finishIdempotentOperation(
      tx,
      input.userId,
      'create_practice',
      input.idempotencyKey,
      practiceId,
    );

    return {
      practiceId,
      status: 'queued',
      remainingFreePractices,
      pollAfterMs: 1_500,
    };
  });
}

function isPending(status: PracticeStatus): boolean {
  return status === 'queued' || status === 'generating' || status === 'validating';
}

import { randomUUID } from 'node:crypto';

import type { PracticeStatus, VocabularyInput } from '@context-reader/contracts';
import { and, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase, AppTransaction } from '../../db/client';
import { jobs, practiceSessions, practiceTargets } from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { getRemainingQuota, reserveQuota } from '../quota/service';
import { rejectDuplicateInputs } from '../vocabulary/normalize';
import {
  selectRandomReviewVocabularyItemIds,
  upsertExactVocabularyItems,
} from '../vocabulary/repository';

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
  },
): Promise<CreatedPractice> {
  rejectDuplicateInputs(input.items);
  return createPracticeWithTargetResolver(db, {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestMaterial: input.items,
    freeLimit: input.freeLimit,
    generationDeadlineMs: input.generationDeadlineMs,
    resolveTargetIds: (tx) =>
      upsertExactVocabularyItems(tx, input.userId, input.items),
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
      targetCount: input.targetCount,
    },
    freeLimit: input.freeLimit,
    generationDeadlineMs: input.generationDeadlineMs,
    resolveTargetIds: async (tx) => {
      const itemIds = await selectRandomReviewVocabularyItemIds(
        tx,
        input.userId,
        input.targetCount,
      );
      if (itemIds.length < input.targetCount) {
        throw new AppError(
          'INSUFFICIENT_VOCABULARY',
          `词库中只有 ${itemIds.length} 个待复习义项，请调低练习数量`,
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
    await tx.insert(practiceSessions).values({
      id: practiceId,
      userId: input.userId,
      examPath: 'ielts',
      status: 'queued',
    });
    const remainingFreePractices = await reserveQuota(
      tx,
      input.userId,
      practiceId,
      input.freeLimit,
    );
    const itemIds = await input.resolveTargetIds(tx);
    await tx.insert(practiceTargets).values(
      itemIds.map((vocabularyItemId, position) => ({
        id: randomUUID(),
        practiceSessionId: practiceId,
        vocabularyItemId,
        position,
      })),
    );
    await tx.insert(jobs).values({
      id: randomUUID(),
      kind: 'practice_generation',
      resourceId: practiceId,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: 3,
      availableAt: new Date(),
      deadlineAt: new Date(Date.now() + input.generationDeadlineMs),
    });
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

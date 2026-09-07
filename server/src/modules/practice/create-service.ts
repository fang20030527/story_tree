import { randomUUID } from 'node:crypto';

import type { PracticeStatus, VocabularyInput } from '@context-reader/contracts';
import { and, eq } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { jobs, practiceSessions, practiceTargets } from '../../db/schema';
import {
  beginIdempotentOperation,
  finishIdempotentOperation,
} from '../idempotency/service';
import { getRemainingQuota, reserveQuota } from '../quota/service';
import { rejectDuplicateInputs } from '../vocabulary/normalize';
import { upsertExactVocabularyItems } from '../vocabulary/repository';

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
  return db.transaction(async (tx) => {
    const replay = await beginIdempotentOperation(
      tx,
      input.userId,
      'create_practice',
      input.idempotencyKey,
      input.items,
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

    rejectDuplicateInputs(input.items);
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
    const itemIds = await upsertExactVocabularyItems(tx, input.userId, input.items);

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

import {
  DashboardDtoSchema,
  type DashboardDto,
} from '@context-reader/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { practiceSessions, vocabularyItems } from '../../db/schema';
import { getRemainingQuota } from '../quota/service';

const incompleteStatuses = [
  'queued',
  'generating',
  'validating',
  'ready',
  'in_progress',
] as const;

export async function getDashboard(
  db: AppDatabase,
  input: { userId: string; freeLimit: number },
): Promise<DashboardDto> {
  const [incomplete, vocabularyCounts, completedCounts, remainingFreePractices] =
    await Promise.all([
      db
        .select({ id: practiceSessions.id })
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.userId, input.userId),
            inArray(practiceSessions.status, incompleteStatuses),
          ),
        )
        .orderBy(desc(practiceSessions.createdAt), desc(practiceSessions.id))
        .limit(1),
      db
        .select({
          vocabularyCount: sql<number>`count(*)::int`,
          reviewingCount: sql<number>`count(*) filter (where ${vocabularyItems.status} = 'reviewing')::int`,
        })
        .from(vocabularyItems)
        .where(
          and(
            eq(vocabularyItems.userId, input.userId),
            isNull(vocabularyItems.deletedAt),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(practiceSessions)
        .where(
          and(
            eq(practiceSessions.userId, input.userId),
            eq(practiceSessions.status, 'completed'),
          ),
        ),
      getRemainingQuota(db, input.userId, input.freeLimit),
    ]);

  return DashboardDtoSchema.parse({
    incompletePracticeId: incomplete[0]?.id ?? null,
    vocabularyCount: vocabularyCounts[0]?.vocabularyCount ?? 0,
    reviewingCount: vocabularyCounts[0]?.reviewingCount ?? 0,
    completedPracticeCount: completedCounts[0]?.count ?? 0,
    remainingFreePractices,
  });
}

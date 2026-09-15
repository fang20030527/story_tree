import {
  DashboardDtoSchema,
  type DashboardDto,
} from '@context-reader/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { practiceSessions } from '../../db/schema';
import { getRemainingQuota } from '../quota/service';
import { loadRankedWords } from '../vocabulary/word-state';

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
      db.transaction((tx) => loadRankedWords(tx, input.userId, new Date())),
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
    vocabularyCount: vocabularyCounts.length,
    reviewingCount: vocabularyCounts.filter((entry) => entry.priority.group < 2).length,
    completedPracticeCount: completedCounts[0]?.count ?? 0,
    remainingFreePractices,
  });
}

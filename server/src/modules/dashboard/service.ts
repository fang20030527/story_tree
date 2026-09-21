import {
  DashboardDtoSchema,
  VocabularyTimeZoneSchema,
  type DashboardDto,
} from '@context-reader/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { AppError } from '../../core/errors';
import type { AppDatabase } from '../../db/client';
import { practiceSessions } from '../../db/schema';
import { getRemainingQuota } from '../quota/service';
import { localDayRange } from '../vocabulary/word-service';
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
  input: { userId: string; freeLimit: number; timeZone?: string },
): Promise<DashboardDto> {
  const timeZone = input.timeZone ?? 'UTC';
  if (!VocabularyTimeZoneSchema.safeParse(timeZone).success) {
    throw new AppError('VALIDATION_ERROR', '时区格式无效', 400);
  }
  const now = new Date();
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
      db.transaction((tx) => loadRankedWords(tx, input.userId, now)),
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

  const active = vocabularyCounts.filter((entry) => entry.word.masteredAt === null);
  const dueLearningCount = active.filter(
    (entry) => entry.state.practiceCount > 0 && entry.priority.group === 1,
  ).length;
  const today = localDayRange(timeZone, now);
  const todayAddedCount = vocabularyCounts.filter(
    (entry) => +entry.word.createdAt >= +today.start && +entry.word.createdAt < +today.end,
  ).length;

  return DashboardDtoSchema.parse({
    incompletePracticeId: incomplete[0]?.id ?? null,
    vocabularyCount: vocabularyCounts.length,
    reviewingCount: dueLearningCount,
    dueLearningCount,
    unlearnedCount: active.filter((entry) => entry.state.practiceCount === 0).length,
    todayAddedCount,
    completedPracticeCount: completedCounts[0]?.count ?? 0,
    remainingFreePractices,
  });
}

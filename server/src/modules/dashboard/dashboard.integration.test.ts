import { describe, expect, it } from 'vitest';

import {
  DashboardDtoSchema,
  PublicErrorSchema,
  VocabularyPageSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  learningProgress,
  practiceSessions,
  usageLedger,
  vocabularyItems,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import {
  normalizeMeaningZh,
  normalizeTerm,
  vocabularyFingerprint,
} from '../vocabulary/normalize';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
  FREE_PRACTICE_LIMIT: '3',
});

const vocabularyIds = {
  newest: '00000000-0000-4000-8000-000000000001',
  tiedLower: '00000000-0000-4000-8000-000000000002',
  tiedHigher: '00000000-0000-4000-8000-000000000003',
  deleted: '00000000-0000-4000-8000-000000000004',
  foreign: '00000000-0000-4000-8000-000000000005',
} as const;

describe('vocabulary and dashboard queries', () => {
  it('paginates deterministically and returns only the owner dashboard', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = 'b1'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const foreign = await registerAnonymous(db, 'b2'.repeat(32), true);
      await seedVocabulary(db, owner.userId, foreign.userId);
      const practiceIds = await seedPractices(db, owner.userId, foreign.userId);
      const app = buildApp({ config, db, logger: false });

      try {
        const headers = { authorization: `Bearer ${token}` };
        const firstResponse = await app.inject({
          method: 'GET',
          url: '/v1/vocabulary-items?limit=2',
          headers,
        });
        expect(firstResponse.statusCode).toBe(200);
        const firstPage = VocabularyPageSchema.parse(firstResponse.json());
        expect(firstPage.items.map(({ id }) => id)).toEqual([
          vocabularyIds.newest,
          vocabularyIds.tiedHigher,
        ]);
        expect(firstPage.items[0]).toMatchObject({
          practiceCount: 2,
          firstTryCorrectCount: 1,
          assistedCount: 1,
          lastPracticedAt: '2026-09-03T08:00:00.000Z',
        });
        expect(firstPage.nextCursor).not.toBeNull();

        const secondResponse = await app.inject({
          method: 'GET',
          url: `/v1/vocabulary-items?limit=2&cursor=${firstPage.nextCursor}`,
          headers,
        });
        expect(secondResponse.statusCode).toBe(200);
        const secondPage = VocabularyPageSchema.parse(secondResponse.json());
        expect(secondPage.items.map(({ id }) => id)).toEqual([
          vocabularyIds.tiedLower,
        ]);
        expect(secondPage.nextCursor).toBeNull();

        const malformed = await app.inject({
          method: 'GET',
          url: '/v1/vocabulary-items?cursor=not-a-valid-cursor!',
          headers,
        });
        expect(malformed.statusCode).toBe(400);
        expect(PublicErrorSchema.parse(malformed.json()).error.code).toBe(
          'VALIDATION_ERROR',
        );

        const unknownCursor = Buffer.from(
          JSON.stringify({
            createdAt: '2026-09-02T08:00:00.000Z',
            id: '00000000-0000-4000-8000-000000000099',
          }),
        ).toString('base64url');
        const unknown = await app.inject({
          method: 'GET',
          url: `/v1/vocabulary-items?cursor=${unknownCursor}`,
          headers,
        });
        expect(unknown.statusCode).toBe(400);
        expect(PublicErrorSchema.parse(unknown.json()).error.code).toBe(
          'VALIDATION_ERROR',
        );

        const dashboardResponse = await app.inject({
          method: 'GET',
          url: '/v1/dashboard',
          headers,
        });
        expect(dashboardResponse.statusCode).toBe(200);
        expect(DashboardDtoSchema.parse(dashboardResponse.json())).toEqual({
          incompletePracticeId: practiceIds.newestIncomplete,
          vocabularyCount: 3,
          reviewingCount: 3,
          completedPracticeCount: 1,
          remainingFreePractices: 2,
        });
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});

async function seedVocabulary(
  db: Parameters<typeof registerAnonymous>[0],
  ownerId: string,
  foreignId: string,
): Promise<void> {
  const rows = [
    {
      id: vocabularyIds.newest,
      userId: ownerId,
      term: 'resilient',
      meaningZh: '有韧性的',
      sourceSentence: 'A resilient system recovers.',
      status: 'reviewing' as const,
      createdAt: new Date('2026-09-03T08:00:00.000Z'),
    },
    {
      id: vocabularyIds.tiedLower,
      userId: ownerId,
      term: 'ambiguous',
      meaningZh: '模棱两可的',
      sourceSentence: null,
      status: 'pending' as const,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
    },
    {
      id: vocabularyIds.tiedHigher,
      userId: ownerId,
      term: 'meticulous',
      meaningZh: '一丝不苟的',
      sourceSentence: null,
      status: 'pending' as const,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
    },
    {
      id: vocabularyIds.deleted,
      userId: ownerId,
      term: 'obsolete',
      meaningZh: '已删除的',
      sourceSentence: null,
      status: 'reviewing' as const,
      createdAt: new Date('2026-09-04T08:00:00.000Z'),
      deletedAt: new Date('2026-09-05T08:00:00.000Z'),
    },
    {
      id: vocabularyIds.foreign,
      userId: foreignId,
      term: 'foreign',
      meaningZh: '其他用户的',
      sourceSentence: null,
      status: 'reviewing' as const,
      createdAt: new Date('2026-09-06T08:00:00.000Z'),
    },
  ];
  await db.insert(vocabularyItems).values(
    rows.map((row) => ({
      ...row,
      normalizedTerm: normalizeTerm(row.term),
      normalizedMeaningZh: normalizeMeaningZh(row.meaningZh),
      fingerprint: vocabularyFingerprint(row.term, row.meaningZh),
      updatedAt: row.createdAt,
    })),
  );
  await db.insert(learningProgress).values([
    {
      vocabularyItemId: vocabularyIds.newest,
      practiceCount: 2,
      firstTryCorrectCount: 1,
      assistedCount: 1,
      lastPracticedAt: new Date('2026-09-03T08:00:00.000Z'),
    },
    {
      vocabularyItemId: vocabularyIds.tiedHigher,
      practiceCount: 1,
      firstTryCorrectCount: 1,
      assistedCount: 0,
      lastPracticedAt: new Date('2026-09-02T08:00:00.000Z'),
    },
  ]);
}

async function seedPractices(
  db: Parameters<typeof registerAnonymous>[0],
  ownerId: string,
  foreignId: string,
): Promise<{ newestIncomplete: string }> {
  const newestIncomplete = '10000000-0000-4000-8000-000000000003';
  const rows = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      userId: ownerId,
      status: 'queued' as const,
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      userId: ownerId,
      status: 'completed' as const,
      createdAt: new Date('2026-09-05T08:00:00.000Z'),
      completedAt: new Date('2026-09-05T09:00:00.000Z'),
    },
    {
      id: newestIncomplete,
      userId: ownerId,
      status: 'ready' as const,
      createdAt: new Date('2026-09-04T08:00:00.000Z'),
      readyAt: new Date('2026-09-04T08:01:00.000Z'),
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      userId: foreignId,
      status: 'completed' as const,
      createdAt: new Date('2026-09-06T08:00:00.000Z'),
      completedAt: new Date('2026-09-06T09:00:00.000Z'),
    },
  ];
  await db.insert(practiceSessions).values(rows);
  await db.insert(usageLedger).values({
    userId: ownerId,
    practiceSessionId: newestIncomplete,
    kind: 'reserve',
    amount: -1,
    operationKey: `${newestIncomplete}:reserve`,
  });
  return { newestIncomplete };
}

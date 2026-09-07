import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  CreatePracticeAcceptedSchema,
  PublicErrorSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  jobs,
  practiceSessions,
  usageLedger,
  vocabularyItems,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import { createPractice } from './create-service';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  FREE_PRACTICE_LIMIT: '3',
  GENERATION_DEADLINE_MS: '120000',
});

const baseItems = [{ term: 'Charge', meaningZh: '收费' }];

describe('transactional practice creation', () => {
  it('coordinates idempotency, vocabulary reuse, quota races, and HTTP', async () => {
    await withTestDatabase(async ({ db }) => {
      const firstToken = '12'.repeat(32);
      const firstUser = await registerAnonymous(db, firstToken, true);
      const request = {
        userId: firstUser.userId,
        idempotencyKey: 'same-key-0000001',
        items: baseItems,
        freeLimit: 3,
        generationDeadlineMs: 120_000,
      };

      const [first, replay] = await Promise.all([
        createPractice(db, request),
        createPractice(db, request),
      ]);
      expect(replay.practiceId).toBe(first.practiceId);
      expect(await db.select().from(vocabularyItems)).toHaveLength(1);
      expect(await db.select().from(practiceSessions)).toHaveLength(1);
      expect(await db.select().from(jobs)).toHaveLength(1);

      const [firstLedger] = await db
        .select({ amount: sql<number>`coalesce(sum(${usageLedger.amount}), 0)::int` })
        .from(usageLedger)
        .where(eq(usageLedger.userId, firstUser.userId));
      expect(firstLedger?.amount).toBe(-1);

      await expect(
        createPractice(db, {
          ...request,
          items: [{ term: 'charge', meaningZh: '指控' }],
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

      const secondUser = await registerAnonymous(db, '34'.repeat(32), true);
      const raced = await Promise.allSettled(
        Array.from({ length: 4 }, (_, index) =>
          createPractice(db, {
            userId: secondUser.userId,
            idempotencyKey: `quota-race-00000${index}`,
            items: baseItems,
            freeLimit: 3,
            generationDeadlineMs: 120_000,
          }),
        ),
      );
      const fulfilled = raced.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createPractice>>> =>
          result.status === 'fulfilled',
      );
      const rejected = raced.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(3);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: 'FREE_LIMIT_REACHED' });

      const secondPractices = await db
        .select({ id: practiceSessions.id })
        .from(practiceSessions)
        .where(eq(practiceSessions.userId, secondUser.userId));
      expect(secondPractices).toHaveLength(3);
      expect(
        await db
          .select()
          .from(jobs)
          .where(inArray(jobs.resourceId, secondPractices.map(({ id }) => id))),
      ).toHaveLength(3);
      expect(
        await db
          .select()
          .from(usageLedger)
          .where(eq(usageLedger.userId, secondUser.userId)),
      ).toHaveLength(3);

      const routeToken = '56'.repeat(32);
      await registerAnonymous(db, routeToken, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const unauthenticated = await app.inject({
          method: 'POST',
          url: '/v1/practices',
          payload: { items: [] },
        });
        expect(unauthenticated.statusCode).toBe(401);
        expect(PublicErrorSchema.parse(unauthenticated.json()).error.code).toBe(
          'UNAUTHORIZED',
        );

        const missingKey = await app.inject({
          method: 'POST',
          url: '/v1/practices',
          headers: { authorization: `Bearer ${routeToken}` },
          payload: { items: baseItems },
        });
        expect(missingKey.statusCode).toBe(400);
        expect(PublicErrorSchema.parse(missingKey.json()).error.code).toBe(
          'VALIDATION_ERROR',
        );

        const response = await app.inject({
          method: 'POST',
          url: '/v1/practices',
          headers: {
            authorization: `Bearer ${routeToken}`,
            'idempotency-key': 'http-create-00001',
          },
          payload: { items: [{ term: 'resilient', meaningZh: '有韧性的' }] },
        });
        expect(response.statusCode).toBe(202);
        expect(CreatePracticeAcceptedSchema.parse(response.json())).toMatchObject({
          status: 'queued',
          remainingFreePractices: 2,
          pollAfterMs: 1_500,
        });

        const auth = await app.inject({
          method: 'POST',
          url: '/v1/auth/anonymous',
          headers: { authorization: `Bearer ${routeToken}` },
          payload: { ageConfirmed14Plus: true },
        });
        expect(auth.json()).toMatchObject({ remainingFreePractices: 2 });
      } finally {
        await app.close();
      }
    });
  }, 90_000);
});

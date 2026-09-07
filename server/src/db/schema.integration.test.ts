import { expect, it } from 'vitest';

import { withTestDatabase } from '../../test/database';
import { jobs, practiceSessions, users } from './schema';

it('migrates an isolated schema and writes a durable practice job', async () => {
  await withTestDatabase(async ({ db, schemaName }) => {
    expect(schemaName).toMatch(/^app_test_[0-9a-f]{32}$/);

    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      kind: 'guest',
      ageConfirmedAt: new Date(),
    });
    const practiceId = crypto.randomUUID();
    await db.insert(practiceSessions).values({
      id: practiceId,
      userId,
      examPath: 'ielts',
      status: 'queued',
    });
    await db.insert(jobs).values({
      id: crypto.randomUUID(),
      kind: 'practice_generation',
      resourceId: practiceId,
      status: 'queued',
      maxAttempts: 3,
      availableAt: new Date(),
      deadlineAt: new Date(Date.now() + 120_000),
    });

    expect(await db.select().from(jobs)).toHaveLength(1);
  });
}, 120_000);

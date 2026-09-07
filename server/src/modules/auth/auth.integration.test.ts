import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicErrorSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import { installations, users } from '../../db/schema';
import { requireAuth } from './routes';
import { registerAnonymous } from './service';
import { hashInstallationToken } from './token';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  FREE_PRACTICE_LIMIT: '3',
});

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('anonymous installation identity', () => {
  it('is idempotent, requires 14+, and stores only a token hash', async () => {
    await withTestDatabase(async ({ db }) => {
      await expect(registerAnonymous(db, 'cd'.repeat(32), false)).rejects.toMatchObject({
        code: 'AGE_CONFIRMATION_REQUIRED',
        statusCode: 403,
      });

      const token = 'ab'.repeat(32);
      const first = await registerAnonymous(db, token, true);
      const second = await registerAnonymous(db, token, true);

      expect(second).toMatchObject({
        userId: first.userId,
        installationId: first.installationId,
        created: false,
      });
      expect(await db.select().from(users)).toHaveLength(1);

      const [row] = await db.select().from(installations);
      expect(row?.tokenHash).toBe(hashInstallationToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
    });
  });

  it('registers over HTTP and authenticates only active bearer tokens', async () => {
    await withTestDatabase(async ({ db }) => {
      const app = buildApp({ config, db, logger: false });
      apps.push(app);
      app.get('/test/private', { preHandler: requireAuth(db) }, async (request) =>
        request.authUser,
      );

      const missing = await app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        payload: { ageConfirmed14Plus: true },
      });
      expect(missing.statusCode).toBe(401);
      expect(PublicErrorSchema.parse(missing.json()).error.code).toBe('UNAUTHORIZED');

      const malformed = await app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        headers: { authorization: 'Bearer not-a-valid-installation-token' },
        payload: { ageConfirmed14Plus: true },
      });
      expect(malformed.statusCode).toBe(401);
      expect(PublicErrorSchema.parse(malformed.json()).error.code).toBe('UNAUTHORIZED');

      const underage = await app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        headers: { authorization: `Bearer ${'01'.repeat(32)}` },
        payload: { ageConfirmed14Plus: false },
      });
      expect(underage.statusCode).toBe(400);
      expect(PublicErrorSchema.parse(underage.json()).error.code).toBe(
        'VALIDATION_ERROR',
      );

      const token = 'ef'.repeat(32);
      const headers = { authorization: `Bearer ${token}` };
      const created = await app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        headers,
        payload: { ageConfirmed14Plus: true },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        kind: 'guest',
        remainingFreePractices: 3,
      });

      const repeated = await app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        headers,
        payload: { ageConfirmed14Plus: true },
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json()).toEqual(created.json());

      const authenticated = await app.inject({
        method: 'GET',
        url: '/test/private',
        headers,
      });
      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json()).toMatchObject({ userId: created.json().userId });

      const [installation] = await db.select().from(installations);
      expect(installation).toBeDefined();
      await db
        .update(installations)
        .set({ revokedAt: new Date() })
        .where(eq(installations.id, installation!.id));

      const revoked = await app.inject({
        method: 'GET',
        url: '/test/private',
        headers,
      });
      expect(revoked.statusCode).toBe(401);
      expect(PublicErrorSchema.parse(revoked.json()).error.code).toBe('TOKEN_REVOKED');
    });
  });
});

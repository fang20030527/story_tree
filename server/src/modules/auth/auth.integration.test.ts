import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicErrorSchema } from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  authIdentities,
  emailAccounts,
  emailPasswordResets,
  installations,
  practiceSessions,
  users,
} from '../../db/schema';
import { requireAuth } from './routes';
import { registerAnonymous } from './service';
import { hashInstallationToken } from './token';
import { hashPasswordResetCode, issuePasswordResetCode, confirmPasswordReset } from './password-reset';
import type { PasswordResetMailer } from './password-reset-mailer';
import { AppError } from '../../core/errors';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
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
  }, 120_000);

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
  }, 120_000);

  it('creates and reuses an email account without storing the password', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '78'.repeat(32);
      const app = buildApp({ config, db, logger: false });
      apps.push(app);

      const first = await app.inject({
        method: 'POST',
        url: '/v1/auth/email',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          email: 'Reader@Example.com',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(first.statusCode).toBe(401);

      const anonymous = await app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        headers: { authorization: `Bearer ${token}` },
        payload: { ageConfirmed14Plus: true },
      });
      expect(anonymous.statusCode).toBe(201);

      const registered = await app.inject({
        method: 'POST',
        url: '/v1/auth/email',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          email: 'Reader@Example.com',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(registered.statusCode).toBe(201);
      expect(registered.json()).toMatchObject({ kind: 'registered' });

      const repeated = await app.inject({
        method: 'POST',
        url: '/v1/auth/email',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          email: 'reader@example.com',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json()).toEqual(registered.json());

      const wrongPassword = await app.inject({
        method: 'POST',
        url: '/v1/auth/email',
        headers: { authorization: `Bearer ${token}` },
        payload: { email: 'reader@example.com', password: 'wrong-password' },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(PublicErrorSchema.parse(wrongPassword.json()).error.code).toBe(
        'EMAIL_AUTH_FAILED',
      );

      const [account] = await db.select().from(emailAccounts);
      expect(account?.email).toBe('reader@example.com');
      expect(account?.passwordHash).not.toContain('correct-horse-battery-staple');
      expect(await db.select().from(emailAccounts)).toHaveLength(1);

      const dataToken = '89'.repeat(32);
      const dataRegistration = await registerAnonymous(db, dataToken, true);
      await db.insert(practiceSessions).values({
        userId: dataRegistration.userId,
        examPath: 'ielts',
        status: 'queued',
      });
      const conflict = await app.inject({
        method: 'POST',
        url: '/v1/auth/email',
        headers: { authorization: `Bearer ${dataToken}` },
        payload: {
          email: 'reader@example.com',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(conflict.statusCode).toBe(409);
      expect(PublicErrorSchema.parse(conflict.json()).error.code).toBe(
        'AUTH_ACCOUNT_CONFLICT',
      );
    });
  }, 120_000);

  it('resets an email password with a single-use code and revokes old installations', async () => {
    await withTestDatabase(async ({ db }) => {
      const oldToken = 'ab'.repeat(32);
      await registerAnonymous(db, oldToken, true);
      const sendCode = vi.fn<PasswordResetMailer['sendCode']>().mockResolvedValue(undefined);
      const app = buildApp({
        config, db, logger: false, passwordResetMailer: { sendCode },
      });
      apps.push(app);

      const registration = await app.inject({
        method: 'POST', url: '/v1/auth/email',
        headers: { authorization: `Bearer ${oldToken}` },
        payload: { email: 'Reader@Example.com', password: 'old-password-123' },
      });
      expect(registration.statusCode).toBe(201);

      const unknown = await app.inject({
        method: 'POST', url: '/v1/auth/password-reset/request',
        payload: { email: 'missing@example.com' },
      });
      const requested = await app.inject({
        method: 'POST', url: '/v1/auth/password-reset/request',
        payload: { email: 'Reader@Example.com' },
      });
      expect(unknown.statusCode).toBe(200);
      expect(requested.statusCode).toBe(200);
      expect(requested.json()).toEqual(unknown.json());
      expect(sendCode).toHaveBeenCalledTimes(1);
      const [sentEmail, code] = sendCode.mock.calls[0]!;
      expect(sentEmail).toBe('reader@example.com');
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/u);
      const [resetRow] = await db.select().from(emailPasswordResets);
      expect(resetRow?.codeHash).toBe(hashPasswordResetCode(code));
      expect(JSON.stringify(resetRow)).not.toContain(code);
      const wrongCode = code === 'AAAAAAAAAAAA' ? 'BBBBBBBBBBBB' : 'AAAAAAAAAAAA';

      const repeatedRequest = await app.inject({
        method: 'POST', url: '/v1/auth/password-reset/request',
        payload: { email: 'reader@example.com' },
      });
      expect(repeatedRequest.statusCode).toBe(200);
      expect(sendCode).toHaveBeenCalledTimes(1);

      const invalid = await app.inject({
        method: 'POST', url: '/v1/auth/password-reset/confirm',
        payload: { email: 'reader@example.com', code: wrongCode, newPassword: 'new-password-456' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(PublicErrorSchema.parse(invalid.json()).error.code).toBe('PASSWORD_RESET_CODE_INVALID');
      const [afterInvalid] = await db.select().from(emailPasswordResets);
      expect(afterInvalid?.attemptsRemaining).toBe(4);

      const confirmed = await app.inject({
        method: 'POST', url: '/v1/auth/password-reset/confirm',
        payload: { email: 'reader@example.com', code, newPassword: 'new-password-456' },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(await db.select().from(emailPasswordResets)).toHaveLength(0);
      const [oldInstallation] = await db.select().from(installations);
      expect(oldInstallation?.revokedAt).not.toBeNull();

      const replayed = await app.inject({
        method: 'POST', url: '/v1/auth/password-reset/confirm',
        payload: { email: 'reader@example.com', code, newPassword: 'third-password-789' },
      });
      expect(replayed.statusCode).toBe(400);

      const newToken = 'bc'.repeat(32);
      await registerAnonymous(db, newToken, true);
      const oldPassword = await app.inject({
        method: 'POST', url: '/v1/auth/email',
        headers: { authorization: `Bearer ${newToken}` },
        payload: { email: 'reader@example.com', password: 'old-password-123' },
      });
      expect(oldPassword.statusCode).toBe(401);
      const newPassword = await app.inject({
        method: 'POST', url: '/v1/auth/email',
        headers: { authorization: `Bearer ${newToken}` },
        payload: { email: 'reader@example.com', password: 'new-password-456' },
      });
      expect(newPassword.statusCode).toBe(200);

      const next = await issuePasswordResetCode(db, 'reader@example.com');
      expect(next).not.toBeNull();
      const nextWrongCode = next!.code === 'AAAAAAAAAAAA' ? 'BBBBBBBBBBBB' : 'AAAAAAAAAAAA';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(confirmPasswordReset(db, 'reader@example.com', nextWrongCode, 'third-password-789'))
          .rejects.toMatchObject({ code: 'PASSWORD_RESET_CODE_INVALID' });
      }
      await expect(confirmPasswordReset(db, 'reader@example.com', next!.code, 'third-password-789'))
        .rejects.toMatchObject({ code: 'PASSWORD_RESET_CODE_INVALID' });
    });
  }, 120_000);

  it('exchanges a WeChat code and upgrades the current installation', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '12'.repeat(32);
      await registerAnonymous(db, token, true);
      const exchangeCode = vi.fn().mockResolvedValue({
        openid: 'wechat-openid-1',
        unionid: 'wechat-unionid-1',
      });
      const app = buildApp({
        config,
        db,
        logger: false,
        wechatClient: { exchangeCode },
      });
      apps.push(app);

      const first = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${token}` },
        payload: { code: 'native-code-1' },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        kind: 'registered',
        remainingFreePractices: 3,
      });
      expect(exchangeCode).toHaveBeenCalledWith('native-code-1');

      const second = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${token}` },
        payload: { code: 'native-code-2' },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());

      const [user] = await db.select().from(users);
      expect(user?.kind).toBe('registered');
      expect(await db.select().from(authIdentities)).toHaveLength(1);
    });
  }, 120_000);

  it('rebinds an empty guest installation but refuses to hide guest data', async () => {
    await withTestDatabase(async ({ db }) => {
      const ownerToken = '23'.repeat(32);
      const guestToken = '34'.repeat(32);
      const dataToken = '45'.repeat(32);
      await registerAnonymous(db, ownerToken, true);
      await registerAnonymous(db, guestToken, true);
      const dataGuest = await registerAnonymous(db, dataToken, true);
      await db.insert(practiceSessions).values({
        userId: dataGuest.userId,
        examPath: 'ielts',
        status: 'queued',
      });

      const exchangeCode = vi.fn().mockResolvedValue({
        openid: 'wechat-openid-2',
        unionid: 'wechat-unionid-2',
      });
      const app = buildApp({
        config,
        db,
        logger: false,
        wechatClient: { exchangeCode },
      });
      apps.push(app);

      const ownerLogin = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { code: 'owner-code' },
      });
      expect(ownerLogin.statusCode).toBe(201);
      const ownerId = ownerLogin.json().userId;

      const rebound = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${guestToken}` },
        payload: { code: 'guest-code' },
      });
      expect(rebound.statusCode).toBe(200);
      expect(rebound.json().userId).toBe(ownerId);

      const conflict = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${dataToken}` },
        payload: { code: 'data-code' },
      });
      expect(conflict.statusCode).toBe(409);
      expect(PublicErrorSchema.parse(conflict.json()).error.code).toBe(
        'AUTH_ACCOUNT_CONFLICT',
      );
    });
  }, 120_000);

  it('maps malformed input and provider failures to stable public errors', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '56'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({
        config,
        db,
        logger: false,
        wechatClient: {
          exchangeCode: vi.fn().mockRejectedValue(
            new AppError('WECHAT_AUTH_FAILED', '微信授权失败', 401),
          ),
        },
      });
      apps.push(app);

      const malformed = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${token}` },
        payload: { code: '' },
      });
      expect(malformed.statusCode).toBe(400);
      expect(PublicErrorSchema.parse(malformed.json()).error.code).toBe(
        'VALIDATION_ERROR',
      );

      const failed = await app.inject({
        method: 'POST',
        url: '/v1/auth/wechat',
        headers: { authorization: `Bearer ${token}` },
        payload: { code: 'bad-code' },
      });
      expect(failed.statusCode).toBe(401);
      expect(PublicErrorSchema.parse(failed.json()).error.code).toBe(
        'WECHAT_AUTH_FAILED',
      );
    });
  }, 120_000);
});

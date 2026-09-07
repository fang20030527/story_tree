import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app';

describe('health routes', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('returns a request id from liveness', async () => {
    const app = buildApp({ logger: false, readiness: async () => true });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns a stable private-safe error when readiness fails', async () => {
    const app = buildApp({
      logger: false,
      readiness: async () => {
        throw new Error('postgresql://user:password@example.invalid/private');
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        retryable: true,
      },
    });
    expect(response.body).not.toContain('password');
  });
});

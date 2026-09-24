import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicErrorSchema } from '@context-reader/contracts';

import { buildApp } from '../app';
import { loadConfig } from '../config/env';
import type { AppDatabase } from '../db/client';
import { registerSecurity } from './security';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
  CORS_ORIGINS: 'https://reader.example.com',
});
const unusedDatabase = {} as AppDatabase;
const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('HTTP security', () => {
  it('allows native requests and exact Web origins while rejecting others', async () => {
    const app = buildApp({ config, db: unusedDatabase, logger: false });
    apps.push(app);

    const native = await app.inject({ method: 'GET', url: '/health/live' });
    expect(native.statusCode).toBe(200);

    const allowed = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://reader.example.com' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://reader.example.com',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();

    const rejected = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://reader.example.com.attacker.invalid' },
    });
    expect(rejected.statusCode).toBe(403);
    expect(PublicErrorSchema.parse(rejected.json()).error.code).toBe(
      'UNAUTHORIZED',
    );
  });

  it('allows import upload and preview methods in CORS preflight', async () => {
    const app = buildApp({ config, db: unusedDatabase, logger: false });
    apps.push(app);

    for (const method of ['PUT', 'PATCH']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/v1/imports/example',
        headers: {
          origin: 'https://reader.example.com',
          'access-control-request-method': method,
        },
      });

      expect(response.statusCode).toBe(204);
      const allowed = response.headers['access-control-allow-methods'] ?? '';
      expect(allowed.split(',').map((value) => value.trim())).toContain(method);
    }
  });

  it('rejects JSON request bodies larger than 32 KiB', async () => {
    const app = buildApp({ config, db: unusedDatabase, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      headers: { authorization: `Bearer ${'c1'.repeat(32)}` },
      payload: {
        ageConfirmed14Plus: true,
        padding: 'x'.repeat(32 * 1_024),
      },
    });

    expect(response.statusCode).toBe(413);
    expect(PublicErrorSchema.parse(response.json()).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
  });

  it('rate limits sensitive routes by token without exposing that token', async () => {
    const logLines: string[] = [];
    const loggerStream = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk));
        callback();
      },
    });
    const app = buildApp({
      config,
      db: unusedDatabase,
      loggerStream,
      securityLimits: {
        globalMax: 100,
        sensitiveMax: 1,
        timeWindowMs: 60_000,
      },
    });
    apps.push(app);
    const firstToken = 'd1'.repeat(32);
    const secondToken = 'd2'.repeat(32);

    const invalidRegistration = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/anonymous',
        headers: { authorization: `Bearer ${token}` },
        payload: { ageConfirmed14Plus: false },
      });
    expect((await invalidRegistration(firstToken)).statusCode).toBe(400);

    const limited = await invalidRegistration(firstToken);
    expect(limited.statusCode).toBe(429);
    expect(PublicErrorSchema.parse(limited.json()).error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(limited.body).not.toContain(firstToken);

    expect((await invalidRegistration(secondToken)).statusCode).toBe(400);
    for (let index = 0; index < 3; index += 1) {
      const health = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { authorization: `Bearer ${firstToken}` },
      });
      expect(health.statusCode).toBe(200);
    }
    expect(logLines.join('')).not.toContain(firstToken);
  });

  it('limits password reset requests by IP even if Authorization changes', async () => {
    const app = buildApp({
      config,
      db: unusedDatabase,
      logger: false,
      securityLimits: { globalMax: 100, passwordResetMax: 1 },
    });
    apps.push(app);
    const request = (authorization: string) => app.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      headers: { authorization },
      payload: { email: 'invalid' },
    });
    expect((await request('Bearer first')).statusCode).toBe(400);
    const limited = await request('Bearer second');
    expect(limited.statusCode).toBe(429);
    expect(PublicErrorSchema.parse(limited.json()).error.code).toBe('RATE_LIMITED');
  });

  it('rate limits sentence translation by token before a paid provider call', async () => {
    const app = Fastify({ logger: false });
    registerSecurity(app, { corsOrigins: [] }, {
      globalMax: 100,
      sentenceMax: 1,
      timeWindowMs: 60_000,
    });
    let providerCalls = 0;
    app.post('/v1/sentence-translations', async () => {
      providerCalls += 1;
      return { translatedTextZh: '译文' };
    });
    try {
      const request = (token: string) => app.inject({
        method: 'POST',
        url: '/v1/sentence-translations',
        headers: { authorization: `Bearer ${token}` },
        payload: { text: 'An English sentence.' },
      });
      const firstToken = 'd3'.repeat(32);
      expect((await request(firstToken)).statusCode).toBe(200);
      const limited = await request(firstToken);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().code).toBe('RATE_LIMITED');
      expect(providerCalls).toBe(1);
      expect((await request('d4'.repeat(32))).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('applies an IP bucket without trusting forwarded addresses', async () => {
    const app = buildApp({
      config,
      db: unusedDatabase,
      logger: false,
      securityLimits: {
        globalMax: 1,
        sensitiveMax: 100,
        timeWindowMs: 60_000,
      },
    });
    apps.push(app);
    app.get('/test/ip-limit', async () => ({ ok: true }));
    const headers = { 'x-forwarded-for': '198.51.100.10' };

    const first = await app.inject({
      method: 'GET',
      url: '/test/ip-limit',
      headers,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'GET',
      url: '/test/ip-limit',
      headers: { ...headers, 'x-forwarded-for': '203.0.113.20' },
    });
    expect(second.statusCode).toBe(429);
    expect(PublicErrorSchema.parse(second.json()).error.code).toBe(
      'RATE_LIMITED',
    );
    expect(second.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('fails readiness when the database check exceeds its deadline', async () => {
    const app = buildApp({
      config,
      db: unusedDatabase,
      logger: false,
      readinessTimeoutMs: 10,
      readiness: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(true), 50);
        }),
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(PublicErrorSchema.parse(response.json()).error.code).toBe(
      'DATABASE_UNAVAILABLE',
    );
  });
});

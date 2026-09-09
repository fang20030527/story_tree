import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { PublicErrorSchema } from '@context-reader/contracts';

import { buildApp } from './app';
import { loadConfig } from './config/env';
import type { AppDatabase } from './db/client';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
});
const unusedDatabase = {} as AppDatabase;

describe('health routes', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('returns a request id from liveness', async () => {
    const app = buildApp({
      config,
      db: unusedDatabase,
      logger: false,
      readiness: async () => true,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns a stable private-safe error when readiness fails', async () => {
    const app = buildApp({
      config,
      db: unusedDatabase,
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

  it('maps parser limits by route without exposing framework details', async () => {
    const app = buildApp({
      config,
      db: unusedDatabase,
      logger: false,
    });
    apps.push(app);
    app.post('/v1/imports/test-parser-error/:kind', async (request) => {
      const kind = (request.params as { kind: string }).kind;
      throw codedError(
        kind === 'mime'
          ? 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          : 'FST_REQ_FILE_TOO_LARGE',
      );
    });
    app.post('/test-json-parser-limit', async () => {
      throw codedError('FST_ERR_CTP_BODY_TOO_LARGE');
    });

    const importLimit = await app.inject({
      method: 'POST',
      url: '/v1/imports/test-parser-error/limit',
    });
    expect(importLimit.statusCode).toBe(413);
    expect(PublicErrorSchema.parse(importLimit.json()).error.code).toBe(
      'IMPORT_TOO_LARGE',
    );

    const invalidMime = await app.inject({
      method: 'POST',
      url: '/v1/imports/test-parser-error/mime',
    });
    expect(invalidMime.statusCode).toBe(415);
    expect(PublicErrorSchema.parse(invalidMime.json()).error.code).toBe(
      'IMPORT_UNSUPPORTED_TYPE',
    );

    const jsonLimit = await app.inject({
      method: 'POST',
      url: '/test-json-parser-limit',
    });
    expect(jsonLimit.statusCode).toBe(413);
    expect(PublicErrorSchema.parse(jsonLimit.json()).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('logs only a fixed classification for unexpected private failures', async () => {
    const canaries = {
      sourceUrl: 'https://private-source.invalid/article-canary',
      filename: 'private-filename-canary.docx',
      uploadCode: 'PRIVATECODE',
      capabilityToken: 'private-capability-token-canary',
      base64: 'cHJpdmF0ZS1vY3ItY2FuYXJ5',
      previewText: 'private preview text canary',
      article: 'private article text canary',
      cookie: 'private-cookie-canary',
      bearer: 'private-bearer-token-canary',
      databaseUrl: 'postgresql://private:password@db.invalid/canary',
      apiKey: 'private-api-key-canary',
      providerCode: 'provider-private-code-canary',
    };
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
    });
    apps.push(app);
    app.post(
      '/test/redacted-validation',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['accepted'],
            properties: { accepted: { type: 'boolean' } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    app.post('/test/unexpected-private-error', async () => {
      const error = codedError(
        canaries.providerCode,
        Object.values(canaries).join('|'),
      ) as Error & Record<string, unknown>;
      Object.assign(error, canaries);
      throw error;
    });

    const validation = await app.inject({
      method: 'POST',
      url: '/test/redacted-validation',
      headers: {
        authorization: `Bearer ${canaries.bearer}`,
        cookie: `cr_upload=${canaries.cookie}`,
      },
      payload: { ...canaries },
    });
    expect(validation.statusCode).toBe(400);

    const unexpected = await app.inject({
      method: 'POST',
      url: '/test/unexpected-private-error',
      headers: {
        authorization: `Bearer ${canaries.bearer}`,
        cookie: `cr_upload=${canaries.cookie}`,
      },
      payload: { ...canaries },
    });
    expect(unexpected.statusCode).toBe(500);
    const publicFailure = PublicErrorSchema.parse(unexpected.json());
    expect(publicFailure.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      retryable: true,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const captured = `${logLines.join('')}\n${validation.body}\n${unexpected.body}`;
    for (const canary of Object.values(canaries)) {
      expect(captured).not.toContain(canary);
    }
    expect(captured).toContain(publicFailure.error.requestId);
    expect(captured).toContain('Unhandled request error');
    expect(captured).toContain('"errorType":"UnexpectedError"');
    expect(captured).toContain('"errorCode":"UNCLASSIFIED"');
    expect(captured).not.toContain('"stack"');
  });
});

function codedError(code: string, message = 'synthetic framework failure'): Error {
  return Object.assign(new Error(message), { code });
}

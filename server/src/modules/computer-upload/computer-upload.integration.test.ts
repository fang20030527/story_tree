import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  CreatedComputerUploadSessionSchema,
  ComputerUploadSessionDtoSchema,
} from '@context-reader/contracts';

import { withTestDatabase } from '../../../test/database';
import { buildApp } from '../../app';
import { loadConfig } from '../../config/env';
import {
  articleImports,
  computerUploadSessions,
  importAssets,
  installations,
  jobs,
} from '../../db/schema';
import { registerAnonymous } from '../auth/service';
import { hashInstallationToken } from '../auth/token';
import { handleArticleImport } from '../imports/handler';
import { claimNextJob, markSucceeded } from '../jobs/repository';
import { renderBrowserErrorPage } from './page';

const config = loadConfig({
  DATABASE_URL: 'postgresql://example.invalid/db',
  EVOLINK_API_KEY: 'test-key',
  PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:8081,http://localhost:19006,http://localhost:3000',
});

const ARTICLE_TEXT = [
  'Careful readers compare evidence before accepting a broad public claim.',
  'They preserve context, inspect uncertainty, and revise conclusions when reliable facts change.',
].join('\n\n');

function authHeaders(token: string, idempotencyKey: string) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': idempotencyKey,
  };
}

async function createSession(
  app: ReturnType<typeof buildApp>,
  token: string,
  idempotencyKey: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/computer-upload-sessions',
    headers: authHeaders(token, idempotencyKey),
    payload: {},
  });
  return response;
}

async function claimCode(
  app: ReturnType<typeof buildApp>,
  code: string,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/computer-upload/claim',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: `code=${encodeURIComponent(code)}`,
  });
}

async function uploadFile(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  content: Buffer | string,
  mediaType: string,
  filename = 'private-hostile-name.txt',
) {
  const form = new FormData();
  const bytes =
    typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  form.set(
    'file',
    new Blob([new Uint8Array(bytes)], { type: mediaType }),
    filename,
  );
  return uploadForm(app, cookie, form);
}

async function encodeMultipart(form: FormData) {
  const encoded = new Request('http://localhost/computer-upload/file', {
    method: 'POST',
    body: form,
  });
  const payload = Buffer.from(await encoded.arrayBuffer());
  const contentType = encoded.headers.get('content-type');
  if (!contentType) throw new Error('Multipart content type missing');
  return { contentType, payload };
}

async function uploadForm(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  form: FormData,
) {
  const { contentType, payload } = await encodeMultipart(form);
  return app.inject({
    method: 'POST',
    url: '/computer-upload/file',
    headers: { cookie, 'content-type': contentType },
    payload,
  });
}

describe('computer upload flow', () => {
  it('creates a session with a reproducible code and never persists it', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '81'.repeat(32);
      const owner = await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const invalid = await app.inject({
          method: 'POST',
          url: '/v1/computer-upload-sessions',
          headers: authHeaders(token, 'cu-invalid-0000001'),
          payload: { unexpected: true },
        });
        expect(invalid.statusCode).toBe(400);

        const startedAt = Date.now();
        const created = await createSession(app, token, 'cu-create-000000001');
        const finishedAt = Date.now();
        expect(created.statusCode).toBe(201);
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        expect(dto.uploadCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/u);
        expect(dto.uploadUrl).toBe(
          `${config.publicServerOrigin}/computer-upload`,
        );
        expect(new Date(dto.expiresAt).getTime()).toBeGreaterThanOrEqual(
          startedAt + 600_000,
        );
        expect(new Date(dto.expiresAt).getTime()).toBeLessThanOrEqual(
          finishedAt + 600_000,
        );

        const replay = await createSession(app, token, 'cu-create-000000001');
        expect(replay.statusCode).toBe(201);
        const replayed = CreatedComputerUploadSessionSchema.parse(
          replay.json(),
        );
        expect(replayed.sessionId).toBe(dto.sessionId);
        expect(replayed.uploadCode).toBe(dto.uploadCode);

        const changedToken = '82'.repeat(32);
        await db.insert(installations).values({
          userId: owner.userId,
          tokenHash: hashInstallationToken(changedToken),
        });
        const conflict = await createSession(
          app,
          changedToken,
          'cu-create-000000001',
        );
        expect(conflict.statusCode).toBe(409);

        const isolatedToken = '83'.repeat(32);
        await registerAnonymous(db, isolatedToken, true);
        const isolated = await createSession(
          app,
          isolatedToken,
          'cu-create-000000001',
        );
        expect(isolated.statusCode).toBe(201);

        const [session] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, dto.sessionId));
        expect(session?.codeHash).toMatch(/^[0-9a-f]{64}$/u);
        expect(session?.codeHash).not.toBe(dto.uploadCode);
        expect(JSON.stringify(session)).not.toContain(dto.uploadCode);

        const [importRow] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, dto.importId));
        expect(importRow?.status).toBe('awaiting_upload');
        expect(importRow?.sourceKind).toBe('computer');

        const otherToken = '8e'.repeat(32);
        await registerAnonymous(db, otherToken, true);
        const foreign = await app.inject({
          method: 'GET',
          url: `/v1/computer-upload-sessions/${dto.sessionId}`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(foreign.statusCode).toBe(404);
        const polled = await app.inject({
          method: 'GET',
          url: `/v1/computer-upload-sessions/${dto.sessionId}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(polled.statusCode).toBe(200);
        const polledDto = ComputerUploadSessionDtoSchema.parse(polled.json());
        expect(polledDto.status).toBe('awaiting_code');
        expect(polled.body).not.toContain(dto.uploadCode);
        expect(polledDto.articleImport.status).toBe('awaiting_upload');
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('claims once atomically and rejects replay, wrong codes, and foreign origins', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '84'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-claim-000000001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());

        const wrong = await claimCode(app, 'AAAAAAAAAA');
        expect(wrong.statusCode).toBe(410);
        expect(wrong.body).not.toContain('AAAAAAAAAA');

        const foreignOrigin = await claimCode(app, dto.uploadCode, {
          origin: 'https://evil.example.com',
        });
        expect(foreignOrigin.statusCode).toBe(403);
        expect(foreignOrigin.headers['content-type']).toContain('text/html');
        expect(foreignOrigin.body).not.toContain(dto.uploadCode);

        const fetchSite = await claimCode(app, dto.uploadCode, {
          'sec-fetch-site': 'cross-site',
        });
        expect(fetchSite.statusCode).toBe(403);
        expect(fetchSite.headers['content-type']).toContain('text/html');
        expect(fetchSite.body).not.toContain(dto.uploadCode);

        const claimed = await claimCode(app, dto.uploadCode);
        expect(claimed.statusCode).toBe(200);
        expect(claimed.headers['content-security-policy']).toContain(
          "default-src 'none'",
        );
        const setCookie = String(claimed.headers['set-cookie']);
        expect(setCookie).toContain('cr_upload=');
        expect(setCookie).toContain('HttpOnly');
        expect(setCookie).toContain('SameSite=Strict');
        expect(setCookie).toContain('Path=/computer-upload');
        expect(setCookie).not.toContain('Secure');
        expect(claimed.body).not.toContain(dto.uploadCode);

        const replay = await claimCode(app, dto.uploadCode);
        expect(replay.statusCode).toBe(410);

        const [session] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, dto.sessionId));
        expect(session?.status).toBe('claimed');
        expect(session?.capabilityTokenHash).toMatch(/^[0-9a-f]{64}$/u);

        const cookie = `cr_upload=${setCookie.match(/cr_upload=([^;]*)/u)?.[1] ?? ''}`;
        const uploaded = await uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain');
        expect(uploaded.statusCode).toBe(200);
        expect(uploaded.body).not.toContain('private-hostile-name.txt');
        expect(uploaded.body).not.toContain(ARTICLE_TEXT.slice(0, 20));

        const [importRow] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, dto.importId));
        expect(importRow?.status).toBe('queued');
        const assets = await db
          .select()
          .from(importAssets)
          .where(eq(importAssets.articleImportId, dto.importId));
        expect(assets).toHaveLength(1);
        const importJobs = await db
          .select()
          .from(jobs)
          .where(eq(jobs.resourceId, dto.importId));
        expect(importJobs).toHaveLength(1);
        const [doneSession] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, dto.sessionId));
        expect(doneSession?.status).toBe('uploaded');
        expect(doneSession?.capabilityTokenHash).toBeNull();

        const secondUpload = await uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain');
        expect(secondUpload.statusCode).toBe(410);
        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, dto.importId)),
        ).toHaveLength(1);
        expect(
          await db.select().from(jobs).where(eq(jobs.resourceId, dto.importId)),
        ).toHaveLength(1);

        const job = await claimNextJob(db, 'computer-upload-worker', 60_000, [
          'article_import',
        ]);
        expect(job?.resourceId).toBe(dto.importId);
        await handleArticleImport(
          { db, fetchMaxBytes: 100, fetchTimeoutMs: 100 },
          job!,
          { signal: new AbortController().signal },
        );
        expect(await markSucceeded(db, job!.id, job!.lockedBy)).toBe(true);
        const [preview] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, dto.importId));
        expect(preview?.status).toBe('preview_ready');
        expect(preview?.previewText).toContain('Careful readers compare evidence');
        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, dto.importId)),
        ).toHaveLength(0);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('rate-limits repeated wrong codes per IP', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '85'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await claimCode(app, 'BBBBBBBBBB');
          expect(response.statusCode).toBe(410);
        }
        const limited = await claimCode(app, 'BBBBBBBBBB');
        expect(limited.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('settles two concurrent valid claims with exactly one capability', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '86'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-race-claim-00001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        const [first, second] = await Promise.all([
          claimCode(app, dto.uploadCode),
          claimCode(app, dto.uploadCode),
        ]);
        const outcomes = [first.statusCode, second.statusCode].sort();
        expect(outcomes).toEqual([200, 410]);
        const [session] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, dto.sessionId));
        expect(session?.status).toBe('claimed');
        expect(session?.capabilityTokenHash).toMatch(/^[0-9a-f]{64}$/u);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('settles two concurrent uploads with exactly one asset and one job', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '87'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-race-upload-0001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        const claimed = await claimCode(app, dto.uploadCode);
        expect(claimed.statusCode).toBe(200);
        const cookie = extractUploadCookie(String(claimed.headers['set-cookie']));
        const [first, second] = await Promise.all([
          uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain'),
          uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain'),
        ]);
        const outcomes = [first.statusCode, second.statusCode].sort();
        expect(outcomes).toEqual([200, 410]);
        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, dto.importId)),
        ).toHaveLength(1);
        expect(
          await db.select().from(jobs).where(eq(jobs.resourceId, dto.importId)),
        ).toHaveLength(1);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('expires overdue claims and capabilities persistently without jobs', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '88'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-expire-00000001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        const claimed = await claimCode(app, dto.uploadCode);
        expect(claimed.statusCode).toBe(200);
        const cookie = extractUploadCookie(String(claimed.headers['set-cookie']));
        const past = new Date(Date.now() - 1_000);
        await db
          .update(computerUploadSessions)
          .set({ expiresAt: past })
          .where(eq(computerUploadSessions.id, dto.sessionId));

        const upload = await uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain');
        expect(upload.statusCode).toBe(410);
        const [session] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, dto.sessionId));
        expect(session?.status).toBe('expired');
        expect(session?.capabilityTokenHash).toBeNull();
        const [importRow] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, dto.importId));
        expect(importRow?.status).toBe('expired');
        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, dto.importId)),
        ).toHaveLength(0);
        expect(
          await db.select().from(jobs).where(eq(jobs.resourceId, dto.importId)),
        ).toHaveLength(0);

        const polled = await app.inject({
          method: 'GET',
          url: `/v1/computer-upload-sessions/${dto.sessionId}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(polled.statusCode).toBe(200);
        expect(
          ComputerUploadSessionDtoSchema.parse(polled.json()).status,
        ).toBe('expired');

        const awaiting = await createSession(
          app,
          token,
          'cu-expire-code-00001',
        );
        const awaitingDto = CreatedComputerUploadSessionSchema.parse(
          awaiting.json(),
        );
        await db
          .update(computerUploadSessions)
          .set({ expiresAt: past })
          .where(eq(computerUploadSessions.id, awaitingDto.sessionId));
        const expiredCode = await claimCode(app, awaitingDto.uploadCode);
        expect(expiredCode.statusCode).toBe(410);
        expect(expiredCode.body).toBe(
          renderBrowserErrorPage('invalid_or_expired'),
        );
        const [expiredAwaiting] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, awaitingDto.sessionId));
        expect(expiredAwaiting?.status).toBe('expired');
        expect(expiredAwaiting?.capabilityTokenHash).toBeNull();
        const [expiredImport] = await db
          .select()
          .from(articleImports)
          .where(eq(articleImports.id, awaitingDto.importId));
        expect(expiredImport?.status).toBe('expired');
        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, awaitingDto.importId)),
        ).toHaveLength(0);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('sets Secure cookies under an HTTPS public origin', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '89'.repeat(32);
      await registerAnonymous(db, token, true);
      const httpsConfig = loadConfig({
        DATABASE_URL: 'postgresql://example.invalid/db',
        EVOLINK_API_KEY: 'test-key',
        PUBLIC_SERVER_ORIGIN: 'https://reader.example.com',
        CORS_ORIGINS: 'https://reader.example.com',
      });
      const app = buildApp({ config: httpsConfig, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-secure-00000001');
        expect(created.statusCode).toBe(201);
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        expect(dto.uploadUrl).toBe('https://reader.example.com/computer-upload');
        const claimed = await app.inject({
          method: 'POST',
          url: '/computer-upload/claim',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'HTTPS://READER.EXAMPLE.COM:443',
          },
          payload: `code=${encodeURIComponent(dto.uploadCode)}`,
        });
        expect(claimed.statusCode).toBe(200);
        expect(String(claimed.headers['set-cookie'])).toContain('Secure');
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('lets the phone poll through claim and upload status transitions', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '8a'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-poll-0000000001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        const poll = async () => {
          const response = await app.inject({
            method: 'GET',
            url: `/v1/computer-upload-sessions/${dto.sessionId}`,
            headers: { authorization: `Bearer ${token}` },
          });
          expect(response.statusCode).toBe(200);
          expect(response.body).not.toContain(dto.uploadCode);
          return ComputerUploadSessionDtoSchema.parse(response.json());
        };
        expect((await poll()).status).toBe('awaiting_code');
        const claimed = await claimCode(app, dto.uploadCode);
        expect(claimed.statusCode).toBe(200);
        expect((await poll()).status).toBe('claimed');
        const cookie = extractUploadCookie(String(claimed.headers['set-cookie']));
        const uploaded = await uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain');
        expect(uploaded.statusCode).toBe(200);
        const done = await poll();
        expect(done.status).toBe('uploaded');
        expect(done.articleImport.status).toBe('queued');

        await db
          .update(computerUploadSessions)
          .set({ expiresAt: new Date(Date.now() - 1_000) })
          .where(eq(computerUploadSessions.id, dto.sessionId));
        const terminal = await poll();
        expect(terminal.status).toBe('uploaded');
        expect(terminal.articleImport.status).toBe('queued');

        const otherToken = '8f'.repeat(32);
        await registerAnonymous(db, otherToken, true);
        const foreign = await app.inject({
          method: 'GET',
          url: `/v1/computer-upload-sessions/${dto.sessionId}`,
          headers: { authorization: `Bearer ${otherToken}` },
        });
        expect(foreign.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('rejects foreign origins on the file upload route too', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '8b'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-origin-000000001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        const claimed = await claimCode(app, dto.uploadCode);
        expect(claimed.statusCode).toBe(200);
        const cookie = extractUploadCookie(String(claimed.headers['set-cookie']));

        const form = new FormData();
        form.set(
          'file',
          new Blob([new Uint8Array(Buffer.from(ARTICLE_TEXT, 'utf8'))], {
            type: 'text/plain',
          }),
          'private-hostile-name.txt',
        );
        const encoded = new Request('http://localhost/computer-upload/file', {
          method: 'POST',
          body: form,
        });
        const payload = Buffer.from(await encoded.arrayBuffer());
        const contentType = encoded.headers.get('content-type');
        if (!contentType) throw new Error('Multipart content type missing');
        const foreign = await app.inject({
          method: 'POST',
          url: '/computer-upload/file',
          headers: {
            cookie,
            'content-type': contentType,
            'sec-fetch-site': 'cross-site',
          },
          payload,
        });
        expect(foreign.statusCode).toBe(403);
        expect(foreign.headers['content-type']).toContain('text/html');
        expect(foreign.body).not.toContain('private-hostile-name.txt');

        const uploaded = await uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain');
        expect(uploaded.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('rejects unsupported, extra, truncated, and oversized multipart bodies without consuming the capability', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '8d'.repeat(32);
      await registerAnonymous(db, token, true);
      const boundedConfig = loadConfig({
        DATABASE_URL: 'postgresql://example.invalid/db',
        EVOLINK_API_KEY: 'test-key',
        PUBLIC_SERVER_ORIGIN: 'http://localhost:3000',
        IMPORT_MAX_FILE_BYTES: '512',
      });
      const app = buildApp({ config: boundedConfig, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-boundary-0000001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        const claimed = await claimCode(app, dto.uploadCode);
        expect(claimed.statusCode).toBe(200);
        const cookie = extractUploadCookie(String(claimed.headers['set-cookie']));

        const unsupported = await uploadFile(
          app,
          cookie,
          ARTICLE_TEXT,
          'application/x-msdownload',
          'private-hostile-name.exe',
        );
        expect(unsupported.statusCode).toBe(422);
        expect(unsupported.body).toBe(renderBrowserErrorPage('unsupported'));
        expect(unsupported.body).not.toContain('private-hostile-name.exe');

        const twoFiles = new FormData();
        twoFiles.append(
          'file',
          new Blob([ARTICLE_TEXT], { type: 'text/plain' }),
          'first-private.txt',
        );
        twoFiles.append(
          'file',
          new Blob(['second private body'], { type: 'text/plain' }),
          'second-private.txt',
        );
        const extraPart = await uploadForm(app, cookie, twoFiles);
        expect(extraPart.statusCode).toBe(422);
        expect(extraPart.body).toBe(renderBrowserErrorPage('unsupported'));
        expect(extraPart.body).not.toContain('second-private.txt');

        const withField = new FormData();
        withField.append('note', 'private field value');
        withField.append(
          'file',
          new Blob([ARTICLE_TEXT], { type: 'text/plain' }),
          'field-private.txt',
        );
        const fieldPart = await uploadForm(app, cookie, withField);
        expect(fieldPart.statusCode).toBe(422);
        expect(fieldPart.body).toBe(renderBrowserErrorPage('unsupported'));
        expect(fieldPart.body).not.toContain('private field value');

        const truncatedForm = new FormData();
        truncatedForm.set(
          'file',
          new Blob([ARTICLE_TEXT], { type: 'text/plain' }),
          'truncated-private.txt',
        );
        const encoded = await encodeMultipart(truncatedForm);
        const truncated = await app.inject({
          method: 'POST',
          url: '/computer-upload/file',
          headers: {
            cookie,
            'content-type': encoded.contentType,
          },
          payload: encoded.payload.subarray(0, encoded.payload.byteLength - 12),
        });
        expect(truncated.statusCode).toBe(422);
        expect(truncated.body).toBe(renderBrowserErrorPage('unsupported'));
        expect(truncated.body).not.toContain('truncated-private.txt');

        const oversized = await uploadFile(
          app,
          cookie,
          Buffer.alloc(513, 0x61),
          'text/plain',
          'oversized-private.txt',
        );
        expect(oversized.statusCode).toBe(413);
        expect(oversized.body).toBe(renderBrowserErrorPage('too_large'));
        expect(oversized.body).not.toContain('oversized-private.txt');

        expect(
          await db
            .select()
            .from(importAssets)
            .where(eq(importAssets.articleImportId, dto.importId)),
        ).toHaveLength(0);
        expect(
          await db.select().from(jobs).where(eq(jobs.resourceId, dto.importId)),
        ).toHaveLength(0);
        const [stillClaimed] = await db
          .select()
          .from(computerUploadSessions)
          .where(eq(computerUploadSessions.id, dto.sessionId));
        expect(stillClaimed?.status).toBe('claimed');
        expect(stillClaimed?.capabilityTokenHash).toMatch(/^[0-9a-f]{64}$/u);

        const valid = await uploadFile(app, cookie, ARTICLE_TEXT, 'text/plain');
        expect(valid.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });
  }, 120_000);

  it('rejects malformed codes without echoing them and limits per code hash', async () => {
    await withTestDatabase(async ({ db }) => {
      const token = '8c'.repeat(32);
      await registerAnonymous(db, token, true);
      const app = buildApp({ config, db, logger: false });
      try {
        const created = await createSession(app, token, 'cu-codelimit-000001');
        const dto = CreatedComputerUploadSessionSchema.parse(created.json());
        // Wrong codes sharing one hash bucket are limited independently of IP.
        const wrongCode = 'CCCCCCCCCC';
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: '/computer-upload/claim',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            remoteAddress: `10.0.0.${attempt + 1}`,
            payload: `code=${wrongCode}`,
          });
          expect(response.statusCode).toBe(410);
        }
        const limited = await app.inject({
          method: 'POST',
          url: '/computer-upload/claim',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          remoteAddress: '10.0.0.99',
          payload: `code=${wrongCode}`,
        });
        // Same code hash from a fresh IP must still be limited by code bucket.
        expect(limited.statusCode).toBe(429);
        // Exhausting the wrong-code bucket cannot block a different code from
        // a fresh address.
        const claimed = await app.inject({
          method: 'POST',
          url: '/computer-upload/claim',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          remoteAddress: '10.0.0.100',
          payload: `code=${encodeURIComponent(dto.uploadCode)}`,
        });
        expect(claimed.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });
  }, 120_000);
});

function extractUploadCookie(setCookie: string): string {
  const match = setCookie.match(/cr_upload=([^;]*)/u);
  if (!match) throw new Error('Upload capability cookie missing');
  return `cr_upload=${match[1]}`;
}

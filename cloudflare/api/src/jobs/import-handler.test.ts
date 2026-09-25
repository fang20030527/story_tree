import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../server/src/core/errors';
import type { ApiEnv } from '../env';
import { handleJobQueue } from './dispatcher';
import { handleArticleImport, failArticleImport } from './import-handler';
import { handleImportConfirmRoute } from '../imports/confirm';
import { handleArticlesRoute } from '../read/articles';
import type { ClaimedJob } from './repository';

const safeFetch = vi.hoisted(() => vi.fn());
const extractHtml = vi.hoisted(() => vi.fn());
const normalizeContent = vi.hoisted(() => vi.fn());

vi.mock('../imports/safe-fetch', () => ({ safeFetchHtmlOnCloudflare: safeFetch }));
vi.mock('../cpu/client', () => ({
  extractHtmlOnCpuBoundary: extractHtml,
  normalizeImportContentOnCpuBoundary: normalizeContent,
}));

const userId = '11111111-1111-4111-8111-111111111111';
const importId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const workerId = 'test-worker';
const instances: Miniflare[] = [];

afterEach(async () => {
  safeFetch.mockReset();
  extractHtml.mockReset();
  normalizeContent.mockReset();
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup(attemptCount = 1, maxAttempts = 3) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'test' },
  }));
  instances.push(mf);
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_initial.sql', '0002_transaction_guards.sql', '0003_import_media.sql']) {
    const sql = readFileSync(resolve('cloudflare/api/migrations', name), 'utf8')
      .split(/\r?\n/u).filter((line) => !/^\s*--/u.test(line)).join('\n');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  const now = new Date();
  const deadlineAt = new Date(now.getTime() + 300_000);
  const leaseExpiresAt = new Date(now.getTime() + 30_000);
  await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .bind(userId, 'guest', now.toISOString()).run();
  await db.prepare(`
    INSERT INTO article_imports
      (id, user_id, source_kind, status, source_url, expires_at)
    VALUES (?, ?, 'url', 'queued', ?, ?)
  `).bind(importId, userId, 'https://publisher.org/story',
    new Date(now.getTime() + 604_800_000).toISOString()).run();
  await db.prepare(`
    INSERT INTO jobs
      (id, kind, resource_id, status, attempt_count, max_attempts,
       available_at, deadline_at, locked_at, lease_expires_at, locked_by)
    VALUES (?, 'article_import', ?, 'running', ?, ?, ?, ?, ?, ?, ?)
  `).bind(jobId, importId, attemptCount, maxAttempts,
    now.toISOString(), deadlineAt.toISOString(), now.toISOString(),
    leaseExpiresAt.toISOString(), workerId).run();
  const job: ClaimedJob = {
    id: jobId, kind: 'article_import', resourceId: importId,
    attemptCount, maxAttempts, deadlineAt, lockedBy: workerId, expired: false,
  };
  return { db, env: { DB: db } as unknown as ApiEnv, job };
}

describe('article import Queue handler on D1', () => {
  it('claims and completes a queued import after the API opens', async () => {
    const { db, env } = await setup();
    await db.prepare(`
      UPDATE jobs SET status = 'queued', locked_at = NULL,
        lease_expires_at = NULL, locked_by = NULL WHERE id = ?
    `).bind(jobId).run();
    Object.assign(env, {
      API_STAGE_OPEN: 'true', EVOLINK_API_KEY: 'test-key',
      RESEND_API_KEY: 'test-key', PASSWORD_RESET_FROM_EMAIL: 'no-reply@danceclip.org',
      JOB_QUEUE: { send: vi.fn() }, CPU_BOUNDARY: {}, IMPORT_BUCKET: {},
      IMAGE_SERVICE: { fetch: vi.fn() }, AI: {}, IMAGES: {},
    });
    safeFetch.mockResolvedValue({
      finalUrl: 'https://publisher.org/story', html: '<article>story</article>',
    });
    extractHtml.mockResolvedValue({
      title: 'A story', text: 'An English article', paragraphs: ['An English article'],
      wordCount: 100, contentHash: 'a'.repeat(64), similarityFingerprint: 42n,
    });
    const ack = vi.fn();
    const retry = vi.fn();

    await handleJobQueue({ messages: [{ body: { jobId }, ack, retry }] }, env);

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    const job = await db.prepare('SELECT status FROM jobs WHERE id = ?')
      .bind(jobId).first<{ status: string }>();
    const imported = await db.prepare('SELECT status FROM article_imports WHERE id = ?')
      .bind(importId).first<{ status: string }>();
    expect(job?.status).toBe('succeeded');
    expect(imported?.status).toBe('preview_ready');
  });

  it('persists an extracted URL preview behind the active lease', async () => {
    const { db, env, job } = await setup();
    safeFetch.mockResolvedValue({
      finalUrl: 'https://publisher.org/story', html: '<article>story</article>',
    });
    extractHtml.mockResolvedValue({
      title: 'A story', text: 'An English article', paragraphs: ['An English article'],
      wordCount: 100, contentHash: 'a'.repeat(64), similarityFingerprint: 42n,
    });

    await handleArticleImport(env, job, { signal: new AbortController().signal });

    const row = await db.prepare(`
      SELECT status, preview_title AS title, preview_text AS text,
        word_count AS wordCount, similarity_fingerprint AS fingerprint,
        failure_code AS failureCode
      FROM article_imports WHERE id = ?
    `).bind(importId).first<{
      status: string; title: string; text: string; wordCount: number;
      fingerprint: string; failureCode: string | null;
    }>();
    expect(row).toMatchObject({
      status: 'preview_ready', title: 'A story', text: 'An English article',
      wordCount: 100, fingerprint: '42', failureCode: null,
    });
    expect(safeFetch).toHaveBeenCalledOnce();
    expect(extractHtml).toHaveBeenCalledOnce();
  });

  it('stores URL images through confirmation and restores media on an exact reimport', async () => {
    const { db, env, job } = await setup();
    const image = {
      type: 'image', afterParagraph: 0, url: 'https://media.publisher.org/field.jpg',
      caption: 'Field evidence', alt: 'Field', credit: null,
      width: 800, height: 450,
    } as const;
    const normalized = {
      title: 'A story', text: 'An English article', paragraphs: ['An English article'],
      media: [image], wordCount: 100, contentHash: 'a'.repeat(64),
      similarityFingerprint: 42n,
    };
    safeFetch.mockResolvedValue({
      finalUrl: 'https://publisher.org/story', html: '<article>story</article>',
    });
    extractHtml.mockResolvedValue(normalized);
    normalizeContent.mockResolvedValue(normalized);
    Object.assign(env, {
      IMPORT_BUCKET: {
        list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
        delete: vi.fn(),
      },
    });

    await handleArticleImport(env, job, { signal: new AbortController().signal });
    const preview = await db.prepare('SELECT preview_media_json AS media FROM article_imports WHERE id = ?')
      .bind(importId).first<{ media: string }>();
    expect(JSON.parse(preview!.media)).toEqual([image]);

    const confirm = (id: string, key: string) => handleImportConfirmRoute(new Request(
      `https://waikan-api.example/v1/imports/${id}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: '{}',
      },
    ), env, userId);
    expect((await confirm(importId, 'confirm-url-media-first'))?.status).toBe(200);
    const article = await db.prepare('SELECT article_id AS id FROM article_imports WHERE id = ?')
      .bind(importId).first<{ id: string }>();
    const detail = () => handleArticlesRoute(new Request(
      `https://waikan-api.example/v1/articles/${article!.id}`,
    ), env, userId);
    expect(await (await detail())?.json()).toMatchObject({ media: [image] });

    await db.prepare('UPDATE imported_articles SET media_json = NULL WHERE id = ?')
      .bind(article!.id).run();
    const secondImportId = '44444444-4444-4444-8444-444444444444';
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO article_imports
        (id, user_id, source_kind, status, source_url, expires_at,
         preview_title, preview_text, preview_media_json, word_count,
         content_hash, similarity_fingerprint, preview_ready_at)
      VALUES (?, ?, 'url', 'preview_ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(secondImportId, userId, 'https://publisher.org/story',
      new Date(Date.now() + 604_800_000).toISOString(), normalized.title,
      normalized.text, JSON.stringify([image]), normalized.wordCount,
      normalized.contentHash, '42', now).run();
    expect((await confirm(secondImportId, 'confirm-url-media-again'))?.status).toBe(200);
    expect(await (await detail())?.json()).toMatchObject({ media: [image] });
  }, 20_000);

  it('restores queued state after a retryable fetch failure', async () => {
    const { db, env, job } = await setup();
    safeFetch.mockRejectedValue(new AppError(
      'IMPORT_FETCH_FAILED', '网页暂时无法读取', 503, true,
    ));

    await expect(handleArticleImport(env, job, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'IMPORT_FETCH_FAILED' });
    const row = await db.prepare('SELECT status FROM article_imports WHERE id = ?')
      .bind(importId).first<{ status: string }>();
    expect(row?.status).toBe('queued');
  });

  it('offers a manual retry when automatic fetch retries are exhausted', async () => {
    const { db, env, job } = await setup(3, 3);
    const failure = new AppError('IMPORT_FETCH_FAILED', '网页暂时无法读取', 503, true);
    // The dispatcher normally calls failArticleImport after the handler throws.
    await failArticleImport(env, job, failure,
      { signal: new AbortController().signal });
    const row = await db.prepare('SELECT status, failure_code AS code FROM article_imports WHERE id = ?')
      .bind(importId).first<{ status: string; code: string }>();
    expect(row).toMatchObject({ status: 'retryable', code: 'IMPORT_FETCH_FAILED' });
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiEnv } from '../env';
import { handleImportProcessRoute } from './process';

const userId = '11111111-1111-4111-8111-111111111111';
const importId = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();
const expires = new Date(Date.now() + 86_400_000).toISOString();
const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup(status: 'awaiting_upload' | 'retryable', withAsset: boolean) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'test' },
  }));
  instances.push(mf);
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_initial.sql', '0002_transaction_guards.sql']) {
    const sql = readFileSync(resolve('cloudflare/api/migrations', name), 'utf8')
      .split(/\r?\n/u).filter((line) => !/^\s*--/u.test(line)).join('\n');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  await db.prepare('INSERT INTO users (id, kind, age_confirmed_at) VALUES (?, ?, ?)')
    .bind(userId, 'guest', now).run();
  const sourceKind = status === 'retryable' ? 'url' : 'local_file';
  const manifest = status === 'retryable' ? null
    : JSON.stringify([{ position: 0, mediaType: 'text/plain', byteSize: 5 }]);
  await db.prepare(`
    INSERT INTO article_imports
      (id, user_id, source_kind, status, source_url, asset_manifest_json,
       failure_code, failure_message_public, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(importId, userId, sourceKind, status,
    status === 'retryable' ? 'https://publisher.org/story' : null, manifest,
    status === 'retryable' ? 'IMPORT_FETCH_FAILED' : null,
    status === 'retryable' ? '网页暂时无法读取' : null, expires).run();
  if (withAsset) {
    await db.prepare(`
      INSERT INTO import_assets
        (id, article_import_id, position, media_type, byte_size, sha256, object_key)
      VALUES (?, ?, 0, 'text/plain', 5, ?, ?)
    `).bind(crypto.randomUUID(), importId, 'a'.repeat(64), `import-assets/${importId}/0/test`).run();
  }
  const send = vi.fn(async (_message: { jobId: string }) => undefined);
  return { db, env: { DB: db, JOB_QUEUE: { send } } as unknown as ApiEnv, send };
}

function request(action: 'process' | 'retry') {
  return new Request(`https://api.example.org/v1/imports/${importId}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': '0123456789abcdef' },
    body: '{}',
  });
}

describe('D1 article import launch', () => {
  it('commits a complete local file once and replays its idempotency key', async () => {
    const { db, env, send } = await setup('awaiting_upload', true);
    const first = await handleImportProcessRoute(request('process'), env, userId);
    const replay = await handleImportProcessRoute(request('process'), env, userId);
    expect(first?.status).toBe(202);
    expect(replay?.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const state = await db.prepare('SELECT status FROM article_imports WHERE id = ?')
      .bind(importId).first<{ status: string }>();
    const jobs = await db.prepare("SELECT count(*) AS count FROM jobs WHERE kind = 'article_import'")
      .first<{ count: number }>();
    expect(state?.status).toBe('queued');
    expect(jobs?.count).toBe(1);
  });

  it('rolls back when a declared asset is missing', async () => {
    const { db, env, send } = await setup('awaiting_upload', false);
    await expect(handleImportProcessRoute(request('process'), env, userId))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(send).not.toHaveBeenCalled();
    const state = await db.prepare('SELECT status FROM article_imports WHERE id = ?')
      .bind(importId).first<{ status: string }>();
    const records = await db.prepare('SELECT count(*) AS count FROM idempotency_records')
      .first<{ count: number }>();
    expect(state?.status).toBe('awaiting_upload');
    expect(records?.count).toBe(0);
  });

  it('retries a URL source with one durable job', async () => {
    const { db, env, send } = await setup('retryable', false);
    const response = await handleImportProcessRoute(request('retry'), env, userId);
    expect(response?.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const row = await db.prepare('SELECT status FROM article_imports WHERE id = ?')
      .bind(importId).first<{ status: string }>();
    expect(row?.status).toBe('queued');
  });
});

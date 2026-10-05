import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireAuth } from '../auth/database';
import { hashInstallationToken } from '../auth/token';
import type { ApiEnv, D1DatabaseBinding } from '../env';
import { createMiniflareD1, disposeMiniflareD1 } from '../test-support/miniflare-d1';
import { handleVocabularyCreateRoute } from '../vocabulary/create';
import { handleAccountDeleteRoute } from './delete';

vi.mock('../cpu/client', () => ({
  verifyEmailPasswordOnCpuBoundary: async (_env: unknown, password: string, hash: string) => hash === `hash:${password}`,
}));

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const base = 'https://blackholeenglish.com';
const token = 'a'.repeat(64);

afterEach(disposeMiniflareD1);

async function count(db: D1DatabaseBinding, sql: string, ...values: unknown[]): Promise<number> {
  return (await db.prepare(sql).bind(...values).first<{ count: number }>())!.count;
}

async function setup(kind: 'guest' | 'registered' = 'registered') {
  const db = await createMiniflareD1('account-delete-test');
  const remove = vi.fn(async () => undefined);
  const env = { DB: db, IMPORT_BUCKET: { delete: remove } } as unknown as ApiEnv;
  const now = new Date().toISOString();
  for (const id of [userId, otherUserId]) {
    await db.prepare('INSERT INTO users (id, kind, age_confirmed_at, username, username_key) VALUES (?, ?, ?, ?, ?)')
      .bind(id, kind, now, `name-${id.slice(0, 4)}`, `name-${id.slice(0, 4)}`).run();
    await handleVocabularyCreateRoute(new Request(`${base}/v1/vocabulary-items`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `vocabulary-${id}` },
      body: JSON.stringify({ term: 'orbit', meaningZh: '轨道' }),
    }), env, id);
    await db.prepare(`INSERT INTO message_bottles (id, user_id, username, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, 'reader', '希望增加更多影片', now).run();
  }
  await db.prepare('INSERT INTO installations (id, user_id, token_hash) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), userId, await hashInstallationToken(token)).run();
  if (kind === 'registered') {
    await db.prepare('INSERT INTO email_accounts (id, user_id, email, password_hash) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, 'reader@example.com', 'hash:secret-password').run();
  }
  await db.prepare(`INSERT INTO speaking_assets (id, user_id, status, content_type, byte_size, purpose, storage_key, expires_at)
    VALUES (?, ?, 'ready', 'audio/mp4', 100, 'recording', ?, ?)`)
    .bind('33333333-3333-4333-8333-333333333333', userId,
      `users/${userId}/33333333-3333-4333-8333-333333333333/source`, now).run();
  const importId = crypto.randomUUID();
  await db.prepare(`INSERT INTO article_imports (id, user_id, source_kind, status, asset_manifest_json, expires_at)
    VALUES (?, ?, 'album', 'awaiting_upload', '[{}]', ?)`).bind(importId, userId, now).run();
  await db.prepare(`INSERT INTO import_assets (id, article_import_id, position, media_type, byte_size, sha256, object_key)
    VALUES (?, ?, 0, 'image/png', 10, ?, 'imports/object-1')`).bind(crypto.randomUUID(), importId, 'b'.repeat(64)).run();
  const practiceId = crypto.randomUUID();
  await db.prepare('INSERT INTO practice_sessions (id, user_id) VALUES (?, ?)').bind(practiceId, userId).run();
  await db.prepare(`INSERT INTO jobs (id, kind, resource_id, deadline_at) VALUES (?, 'practice_generation', ?, ?)`)
    .bind(crypto.randomUUID(), practiceId, now).run();
  await db.prepare(`INSERT INTO quota_usage_events (practice_session_id, device_hash, ip_hash, created_at) VALUES (?, 'device', NULL, ?)`)
    .bind(practiceId, now).run();
  return { db, env, remove };
}

function remove(env: ApiEnv, body: unknown = {}) {
  return handleAccountDeleteRoute(new Request(`${base}/v1/account/delete`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, userId);
}

describe('注销账号', () => {
  it('邮箱账号需要正确的密码确认', async () => {
    const { db, env } = await setup();
    await expect(remove(env)).rejects.toMatchObject({ code: 'ACCOUNT_PASSWORD_REQUIRED' });
    await expect(remove(env, { password: 'wrong-password' })).rejects.toMatchObject({ code: 'EMAIL_AUTH_FAILED' });
    expect(await count(db, 'SELECT COUNT(*) AS count FROM users WHERE id = ?', userId)).toBe(1);
  });

  it('删除账号和它的全部数据，私有录音进入清理队列，设备当天的额度记录保留', async () => {
    const { db, env, remove: removeObjects } = await setup();
    expect((await remove(env, { password: 'secret-password' }))!.status).toBe(204);

    for (const table of ['users', 'vocabulary_items', 'vocabulary_words', 'message_bottles', 'email_accounts',
      'installations', 'speaking_assets', 'article_imports', 'practice_sessions']) {
      expect(await count(db, `SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} = ?`, userId)).toBe(0);
    }
    expect(await count(db, 'SELECT COUNT(*) AS count FROM import_assets')).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS count FROM jobs')).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS count FROM speaking_storage_cleanup WHERE storage_key LIKE ?', `users/${userId}/%`)).toBe(1);
    expect(removeObjects).toHaveBeenCalledWith(['imports/object-1']);
    expect(await count(db, 'SELECT COUNT(*) AS count FROM quota_usage_events')).toBe(1);
    // Someone else's data is untouched, and the old token no longer signs in.
    expect(await count(db, 'SELECT COUNT(*) AS count FROM vocabulary_items WHERE user_id = ?', otherUserId)).toBe(1);
    expect(await count(db, 'SELECT COUNT(*) AS count FROM message_bottles WHERE user_id = ?', otherUserId)).toBe(1);
    await expect(requireAuth(new Request(base, { headers: { authorization: `Bearer ${token}` } }), env))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('游客没有密码，也可以删除本机的云端学习数据', async () => {
    const { db, env } = await setup('guest');
    expect((await remove(env))!.status).toBe(204);
    expect(await count(db, 'SELECT COUNT(*) AS count FROM users WHERE id = ?', userId)).toBe(0);
  });
});

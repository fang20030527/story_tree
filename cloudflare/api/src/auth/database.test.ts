import { afterEach, describe, expect, it } from 'vitest';

import { closeTestDatabases, createTestD1, insertUserWithToken } from '../test-support/sqlite-d1';
import { LAST_SEEN_REFRESH_MS, requireAuth } from './database';

const userId = '11111111-1111-4111-8111-111111111111';

afterEach(closeTestDatabases);

function request(token: string | null): Request {
  return new Request('https://example.com/v1/dashboard', token === null ? {} : {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function setup() {
  const { sqlite, db, env } = createTestD1();
  const token = await insertUserWithToken(sqlite, userId);
  const writes: string[] = [];
  db.onPrepare = (sql) => { if (/^\s*UPDATE installations/u.test(sql)) writes.push(sql); };
  const lastSeen = () => (sqlite.prepare('SELECT last_seen_at AS value FROM installations').get() as { value: string }).value;
  const setLastSeen = (value: string) => sqlite.prepare('UPDATE installations SET last_seen_at = ?').run(value);
  return { sqlite, env, token, writes, lastSeen, setLastSeen };
}

describe('requireAuth', () => {
  it('accepts an active installation and refreshes last_seen_at at most every 15 minutes', async () => {
    const { env, token, writes, lastSeen, setLastSeen } = await setup();
    const stale = new Date(Date.now() - LAST_SEEN_REFRESH_MS - 1_000).toISOString();
    setLastSeen(stale);

    const context = await requireAuth(request(token), env);
    expect(context.userId).toBe(userId);
    expect(writes).toHaveLength(1);
    const refreshed = lastSeen();
    expect(Date.parse(refreshed)).toBeGreaterThan(Date.parse(stale));

    // Further requests within the window only read.
    await requireAuth(request(token), env);
    await requireAuth(request(token), env);
    expect(writes).toHaveLength(1);
    expect(lastSeen()).toBe(refreshed);

    // A value that cannot be read is replaced rather than trusted.
    setLastSeen('not a date');
    await requireAuth(request(token), env);
    expect(writes).toHaveLength(2);
  });

  it('rejects a revoked token or a deleted account as revoked, and an unknown token as invalid', async () => {
    const { sqlite, env, token } = await setup();
    await expect(requireAuth(request(null), env)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(requireAuth(request('f'.repeat(64)), env)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    sqlite.prepare('UPDATE users SET deleted_at = ?').run(new Date().toISOString());
    await expect(requireAuth(request(token), env)).rejects.toMatchObject({ code: 'TOKEN_REVOKED', statusCode: 401 });
    sqlite.prepare('UPDATE users SET deleted_at = NULL').run();

    sqlite.prepare('UPDATE installations SET revoked_at = ?').run(new Date().toISOString());
    await expect(requireAuth(request(token), env)).rejects.toMatchObject({ code: 'TOKEN_REVOKED', statusCode: 401 });
  });

  it('does not fail the request when the last_seen_at refresh fails', async () => {
    const { env, token, setLastSeen } = await setup();
    setLastSeen('2020-01-01T00:00:00.000Z');
    const failing = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          const statement = env.DB.prepare(sql);
          if (!/^UPDATE installations/u.test(sql)) return statement;
          return { ...statement, bind: () => ({ run: () => Promise.reject(new Error('D1 overloaded')) }) };
        },
        batch: env.DB.batch.bind(env.DB),
      },
    } as unknown as typeof env;
    await expect(requireAuth(request(token), failing)).resolves.toMatchObject({ userId });
  });
});

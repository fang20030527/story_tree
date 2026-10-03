import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { RESERVED_USERNAMES, UsernameSchema, checkUsername } from '@context-reader/contracts';

import {
  AGE_CONFIRMED_AT, closeTestDatabases, createTestD1, readMigration,
} from '../test-support/sqlite-d1';
import { deriveUsernameBase } from './username';

afterEach(closeTestDatabases);

const MIGRATION = '0009_usernames.sql';
const beforeBackfill = (name: string) => name < MIGRATION;

// 账号 ID 的前 8 位十六进制由序号决定，便于推算同名账号和兜底名的后缀。
const hex8 = (n: number) => n.toString(16).padStart(8, '0');
const userId = (n: number) => `${hex8(n)}-0000-4000-8000-000000000000`;
const fallback = (n: number) => `用户_${hex8(n)}`;
const at = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;

interface Fixture {
  n: number;
  kind?: 'guest' | 'registered';
  deleted?: boolean;
  username?: string;
  emails?: Array<{ email: string; createdAt?: string }>;
  wechat?: boolean;
}

function seed(sqlite: DatabaseSync, fixtures: Fixture[]) {
  for (const fixture of fixtures) {
    const id = userId(fixture.n);
    sqlite.prepare(`INSERT INTO users(id, kind, age_confirmed_at, created_at, deleted_at, username, username_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id, fixture.kind ?? 'registered', AGE_CONFIRMED_AT, at(fixture.n),
      fixture.deleted ? at(59) : null,
      fixture.username ?? null, fixture.username ? fixture.username.toLowerCase() : null,
    );
    (fixture.emails ?? []).forEach((entry, index) => {
      sqlite.prepare(`INSERT INTO email_accounts(id, user_id, email, password_hash, created_at, last_login_at)
        VALUES (?, ?, ?, 'hash', ?, ?)`).run(
        crypto.randomUUID(), id, entry.email, entry.createdAt ?? at(fixture.n + index), at(fixture.n),
      );
    });
    if (fixture.wechat) {
      sqlite.prepare(`INSERT INTO auth_identities(id, user_id, provider, subject, openid, unionid, created_at, last_login_at)
        VALUES (?, ?, 'wechat', ?, ?, ?, ?, ?)`).run(
        crypto.randomUUID(), id, `union-${fixture.n}`, `open-${fixture.n}`, `union-${fixture.n}`, at(fixture.n), at(fixture.n),
      );
    }
  }
}

interface UserRow { id: string; username: string | null; username_key: string | null }
const users = (sqlite: DatabaseSync) =>
  sqlite.prepare('SELECT id, username, username_key FROM users ORDER BY id').all() as unknown as UserRow[];
const nameOf = (sqlite: DatabaseSync, n: number) =>
  (sqlite.prepare('SELECT username FROM users WHERE id = ?').get(userId(n)) as { username: string | null }).username;

function database(fixtures: Fixture[]) {
  const context = createTestD1(beforeBackfill);
  seed(context.sqlite, fixtures);
  return context;
}

describe('0009_usernames.sql 回填', () => {
  const fixtures: Fixture[] = [
    { n: 1, emails: [{ email: 'john.smith@gmail.com' }] },
    { n: 2, emails: [{ email: 'john.smith@outlook.com' }] }, // 同前缀，后注册
    { n: 3, emails: [{ email: 'a+news@x.com' }] },
    { n: 4, emails: [{ email: "o'neil@x.com" }] },
    { n: 5, emails: [{ email: 'fzy13967021190@gmail.com' }] }, // 含手机号
    { n: 6, emails: [{ email: '12345@qq.com' }] }, // 5 位数字可以保留
    { n: 7, emails: [{ email: 'x@y.com' }] }, // 太短
    { n: 8, emails: [{ email: 'admin@x.com' }] },
    { n: 9, emails: [{ email: 'a.d.m.i.n@x.com' }] },
    { n: 10, emails: [{ email: '_._@x.com' }] }, // 没有字母或数字
    { n: 11, emails: [{ email: `${'x'.repeat(30)}@x.com` }] },
    { n: 12, emails: [{ email: 'Bob@X.com' }] }, // 历史数据未规范化大小写
    { n: 13, emails: [{ email: '张三@x.com' }] },
    { n: 14, wechat: true }, // 只用微信登录，没有邮箱
    { n: 15, emails: [
      { email: 'second@x.com', createdAt: at(40) },
      { email: 'first@x.com', createdAt: at(30) },
    ] },
    { n: 16, emails: [{ email: 'alice@x.com' }] }, // 名字已被 n=20 占用
    { n: 17, kind: 'guest' },
    { n: 18, deleted: true, emails: [{ email: 'deleted@x.com' }] },
    { n: 19, username: '小林', emails: [{ email: 'xiaolin@x.com' }] },
    { n: 20, username: 'Alice', emails: [{ email: 'someone@x.com' }] },
    { n: 21, emails: [{ email: 'user12345@x.com' }] },
    { n: 22, emails: [{ email: 'abc123456@x.com' }] },
    { n: 23, emails: [{ email: 'support@x.com' }] },
    { n: 24, emails: [{ email: 'blackholeenglish@x.com' }] },
    { n: 25, kind: 'registered' }, // 注册账号但没有任何登录方式记录
  ];
  const expected: Record<number, string | null> = {
    1: 'john.smith', 2: `john.smith_${hex8(2)}`, 3: 'a_news', 4: 'o_neil',
    5: fallback(5), 6: '12345', 7: fallback(7), 8: fallback(8), 9: fallback(9), 10: fallback(10),
    11: 'x'.repeat(24), 12: 'bob', 13: fallback(13), 14: fallback(14), 15: 'first',
    16: `alice_${hex8(16)}`, 17: null, 18: null, 19: '小林', 20: 'Alice',
    21: 'user12345', 22: fallback(22), 23: fallback(23), 24: fallback(24), 25: fallback(25),
  };

  it('按规则回填，游客、已删除账号和已有用户名保持不变', () => {
    const { sqlite } = database(fixtures);
    sqlite.exec(readMigration(MIGRATION));
    for (const [n, name] of Object.entries(expected)) expect(nameOf(sqlite, Number(n)), `账号 ${n}`).toBe(name);
  });

  it('回填的名字全部唯一、键为小写，并且用户之后可以原样保存', () => {
    const { sqlite } = database(fixtures);
    sqlite.exec(readMigration(MIGRATION));
    const rows = users(sqlite).filter(row => row.username !== null);
    expect(rows.length).toBeGreaterThan(20);
    expect(new Set(rows.map(row => row.username_key)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.username_key, row.username ?? '').toBe(row.username!.toLowerCase());
      expect(UsernameSchema.safeParse(row.username).success, row.username ?? '').toBe(true);
      expect(checkUsername(row.username!).ok, row.username ?? '').toBe(true);
    }
  });

  it('不改动用户表的其他列，临时表和断言行都被清理', () => {
    const { sqlite } = database(fixtures);
    const others = () => sqlite.prepare('SELECT id, kind, age_confirmed_at, created_at, deleted_at FROM users ORDER BY id').all();
    const snapshot = others();
    sqlite.exec(readMigration(MIGRATION));
    expect(others()).toEqual(snapshot);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'username_backfill'").all()).toEqual([]);
    expect(sqlite.prepare('SELECT count(*) AS total FROM transaction_guards').get()).toEqual({ total: 0 });
  });

  it('重复执行没有副作用，之后新增的账号也不会被误改', () => {
    const { sqlite } = database(fixtures);
    sqlite.exec(readMigration(MIGRATION));
    const first = users(sqlite);
    sqlite.exec(readMigration(MIGRATION));
    expect(users(sqlite)).toEqual(first);
    seed(sqlite, [{ n: 30, username: 'Manual', emails: [{ email: 'manual@x.com' }] }]);
    sqlite.exec(readMigration(MIGRATION));
    expect(nameOf(sqlite, 30)).toBe('Manual');
  });

  it('在完整迁移链上无需任何数据时也能执行', () => {
    const { sqlite } = createTestD1();
    expect(users(sqlite)).toEqual([]);
    sqlite.exec(readMigration(MIGRATION));
    expect(users(sqlite)).toEqual([]);
  });

  it('断言发现重复时中止且不写入任何用户名，清理冲突后可以重试', () => {
    // 极端情况：三个账号前缀相同且 ID 前 8 位也相同，第二层名字会撞车。
    const { sqlite } = database([]);
    const ids = [1, 2, 3].map(n => `deadbeef-000${n}-4000-8000-000000000000`);
    ids.forEach((id, index) => {
      sqlite.prepare('INSERT INTO users(id, kind, age_confirmed_at, created_at) VALUES (?, ?, ?, ?)')
        .run(id, 'registered', AGE_CONFIRMED_AT, at(index + 1));
      sqlite.prepare(`INSERT INTO email_accounts(id, user_id, email, password_hash, created_at, last_login_at)
        VALUES (?, ?, ?, 'hash', ?, ?)`).run(crypto.randomUUID(), id, `dup@${'abc'[index]}.com`, at(index + 1), at(index + 1));
    });
    expect(() => sqlite.exec(readMigration(MIGRATION))).toThrow(/CHECK constraint failed/);
    expect(users(sqlite).every(row => row.username === null && row.username_key === null)).toBe(true);
    expect(sqlite.prepare('SELECT count(*) AS total FROM transaction_guards').get()).toEqual({ total: 0 });

    sqlite.prepare('DELETE FROM users WHERE id = ?').run(ids[2]!);
    sqlite.exec(readMigration(MIGRATION)); // 上次中止留下的临时表不影响重试
    expect(users(sqlite).map(row => row.username).sort()).toEqual(['dup', 'dup_deadbeef']);
  });
});

describe('SQL 回填与 TypeScript 自动生成的前缀规则一致', () => {
  const emails = [
    'john.smith@gmail.com', 'Bob@X.com', 'a+news@x.com', "o'neil@x.com", 'fzy13967021190@gmail.com',
    '12345@qq.com', '123456@qq.com', 'abc12345@x.com', 'abc123456@x.com', 'ab12345@x.com', 'x@y.com',
    '_._@x.com', '__@x.com', '--a@x.com', 'a-b_c.d@x.com', 'admin@x.com', 'Admin@x.com', 'a.d.m.i.n@x.com',
    'support@x.com', 'root@x.com', 'a_d_m_i_n@x.com', 'blackholeenglish@x.com', 'blackhole@x.com', '张三@x.com',
    'abcdefghijklmnopqrstuvwxyz@x.com', `${'x'.repeat(24)}123456@x.com`, `${'a'.repeat(23)}12345678@x.com`,
    '\u212Aelvin@x.com', 'ab@x.com', '@x.com', 'noatsign',
  ];

  it.each(emails)('%s', email => {
    const { sqlite } = database([{ n: 1, emails: [{ email }] }]);
    sqlite.exec(readMigration(MIGRATION));
    expect(nameOf(sqlite, 1)).toBe(deriveUsernameBase(email) ?? fallback(1));
  });

  it('SQL 和 TypeScript 使用同一份英文保留字', () => {
    const ascii = RESERVED_USERNAMES.filter(name => /^[a-z]+$/u.test(name));
    expect(ascii.length).toBeGreaterThan(5);
    for (const name of ascii) {
      const { sqlite } = database([{ n: 1, emails: [{ email: `${name}@example.com` }] }]);
      sqlite.exec(readMigration(MIGRATION));
      expect(nameOf(sqlite, 1), name).toBe(fallback(1));
      expect(deriveUsernameBase(`${name}@example.com`), name).toBeNull();
    }
  });
});

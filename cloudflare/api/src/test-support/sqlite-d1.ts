import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { ApiEnv, D1DatabaseBinding, D1StatementBinding } from '../env';
import { hashInstallationToken } from '../auth/token';

// 仅供测试使用：用 Node 内置 SQLite 模拟 D1。batch 在事务里执行，任一语句失败整批回滚，
// 与 D1 的批处理语义一致。

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql')).sort();
export const readMigration = (name: string): string =>
  readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8');

class Statement implements D1StatementBinding {
  constructor(readonly db: TestD1, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.db, this.sql, values as SQLInputValue[]); }
  async first<T>(): Promise<T | null> {
    return (this.db.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() { return { results: this.db.sqlite.prepare(this.sql).all(...this.values) as T[] }; }
  execute() { return this.db.sqlite.prepare(this.sql).run(...this.values); }
  async run() { return this.execute(); }
}

export class TestD1 implements D1DatabaseBinding {
  /** 在下一次 batch 开始前执行一次，用来模拟检查与写入之间发生的并发修改。 */
  beforeBatch: (() => void) | undefined;
  /** 每准备一条语句时调用，可用来记录 SQL，或在指定语句执行前注入并发修改。 */
  onPrepare: ((sql: string) => void) | undefined;
  batches = 0;
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string) {
    this.onPrepare?.(sql);
    return new Statement(this, sql);
  }
  async batch(statements: D1StatementBinding[]) {
    const hook = this.beforeBatch;
    this.beforeBatch = undefined;
    hook?.();
    this.batches += 1;
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => (statement as Statement).execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

const databases: DatabaseSync[] = [];
export const closeTestDatabases = () => databases.splice(0).forEach(database => database.close());

/** 创建内存库并按文件名顺序应用迁移；filter 可只应用其中一部分。 */
export function createTestD1(filter: (migration: string) => boolean = () => true) {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of migrationFiles()) if (filter(file)) sqlite.exec(readMigration(file));
  const db = new TestD1(sqlite);
  return { sqlite, db, env: { DB: db } as unknown as ApiEnv };
}

export const AGE_CONFIRMED_AT = '2026-10-01T00:00:00.000Z';

/** 插入一个带安装令牌的用户，返回可用于 Authorization 头的令牌。 */
export async function insertUserWithToken(
  sqlite: DatabaseSync,
  userId: string,
  kind: 'guest' | 'registered' = 'guest',
): Promise<string> {
  const token = userId.replaceAll('-', '').repeat(2).slice(0, 64);
  sqlite.prepare('INSERT INTO users(id, kind, age_confirmed_at) VALUES (?, ?, ?)').run(userId, kind, AGE_CONFIRMED_AT);
  sqlite.prepare('INSERT INTO installations(id, user_id, token_hash) VALUES (?, ?, ?)')
    .run(crypto.randomUUID(), userId, await hashInstallationToken(token));
  return token;
}

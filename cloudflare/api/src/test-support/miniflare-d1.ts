import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

import type { D1DatabaseBinding } from '../env';

// 仅供测试使用：Miniflare 的本地 D1 与线上一样在 batch 结果里返回 RETURNING 行，
// node:sqlite 版的 createTestD1 不返回，所以依赖这些行的路由用这里的库测试。

const instances: Miniflare[] = [];

/** 应用全部迁移的本地 D1。测试结束时调用 disposeMiniflareD1。 */
export async function createMiniflareD1(name: string): Promise<D1DatabaseBinding> {
  const instance = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: name },
  }));
  instances.push(instance);
  const db = await instance.getD1Database('DB');
  const directory = resolve('cloudflare/api/migrations');
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(directory, file), 'utf8')
      .split(/\r?\n/u).filter((line) => !/^\s*--/u.test(line)).join('\n');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  return db as unknown as D1DatabaseBinding;
}

export async function disposeMiniflareD1(): Promise<void> {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
}

/**
 * The same database, recording how many values each statement binds. Production D1 rejects a
 * statement with more than 100 bound parameters; the local one does not.
 */
export function countingBindings(db: D1DatabaseBinding): { db: D1DatabaseBinding; counts: number[] } {
  const counts: number[] = [];
  return {
    counts,
    db: {
      prepare(sql) {
        const statement = db.prepare(sql);
        const bind = statement.bind.bind(statement);
        return Object.assign(statement, {
          bind: (...values: unknown[]) => {
            counts.push(values.length);
            return bind(...values);
          },
        });
      },
      batch: (statements) => db.batch(statements),
    },
  };
}

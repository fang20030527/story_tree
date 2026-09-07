import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { AppDatabase, DatabaseHandle } from '../src/db/client';
import * as schema from '../src/db/schema';

const SAFE_SCHEMA_PATTERN = /^app_test_[0-9a-f]{32}$/;

export async function withTestDatabase<T>(
  run: (context: { db: AppDatabase; pool: Pool; schemaName: string }) => Promise<T>,
): Promise<T> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Database integration tests require TEST_DATABASE_URL or DATABASE_URL');
  }

  const schemaName = `app_test_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!SAFE_SCHEMA_PATTERN.test(schemaName)) throw new Error('Unsafe test schema name');

  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  let schemaCreated = false;
  let testDatabase: DatabaseHandle | undefined;
  let temporaryMigrationRoot: string | undefined;

  try {
    await adminPool.query(`create schema "${schemaName}"`);
    schemaCreated = true;

    const pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      onConnect: async (client) => {
        await client.query(`set search_path to "${schemaName}", public`);
      },
    });
    const searchPath = await pool.query<{ schema_name: string }>(
      'select current_schema() as schema_name',
    );
    if (searchPath.rows[0]?.schema_name !== schemaName) {
      throw new Error('Test database search path was not initialized');
    }
    const database = createDatabaseFromPool(pool);
    testDatabase = database;
    const isolatedMigrations = await prepareIsolatedMigrations(schemaName);
    temporaryMigrationRoot = isolatedMigrations.root;

    await migrate(database.db, {
      migrationsFolder: isolatedMigrations.folder,
      migrationsSchema: schemaName,
    });

    return await run({ db: database.db, pool, schemaName });
  } finally {
    await testDatabase?.close();
    if (schemaCreated && SAFE_SCHEMA_PATTERN.test(schemaName)) {
      await adminPool.query(`drop schema "${schemaName}" cascade`);
    }
    await adminPool.end();
    if (temporaryMigrationRoot) {
      await rm(temporaryMigrationRoot, { recursive: true, force: true });
    }
  }
}

function createDatabaseFromPool(pool: Pool): DatabaseHandle {
  return {
    pool,
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  };
}

async function prepareIsolatedMigrations(schemaName: string) {
  if (!SAFE_SCHEMA_PATTERN.test(schemaName)) throw new Error('Unsafe test schema name');

  const root = await mkdtemp(join(tmpdir(), 'context-reader-migrations-'));
  const folder = join(root, 'drizzle');
  const source = fileURLToPath(new URL('../drizzle', import.meta.url));

  try {
    await cp(source, folder, { recursive: true });

    const migrationFiles = (await readdir(folder)).filter((name) => name.endsWith('.sql'));
    for (const name of migrationFiles) {
      const path = join(folder, name);
      const original = await readFile(path, 'utf8');
      const isolated = original
        .replaceAll('"public".', `"${schemaName}".`)
        .replaceAll('--> statement-breakpoint', '');
      if (isolated.includes('"public".')) {
        throw new Error('Migration still targets public schema');
      }
      await writeFile(path, isolated, 'utf8');
    }

    return { root, folder };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

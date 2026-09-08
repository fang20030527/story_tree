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
const TRANSIENT_DATABASE_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);

export async function withTestDatabase<T>(
  run: (context: { db: AppDatabase; pool: Pool; schemaName: string }) => Promise<T>,
): Promise<T> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Database integration tests require TEST_DATABASE_URL or DATABASE_URL');
  }
  const sessionDatabaseUrl = resolveSessionDatabaseUrl(databaseUrl);

  const schemaName = `app_test_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!SAFE_SCHEMA_PATTERN.test(schemaName)) throw new Error('Unsafe test schema name');

  let schemaCreated = false;
  let testDatabase: DatabaseHandle | undefined;
  let temporaryMigrationRoot: string | undefined;

  try {
    await runAdminQuery(
      sessionDatabaseUrl,
      `create schema "${schemaName}"`,
    );
    schemaCreated = true;

    const pool = new Pool({
      connectionString: sessionDatabaseUrl,
      max: 5,
      options: `-c search_path=${schemaName},public`,
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
    try {
      await testDatabase?.close();
    } finally {
      try {
        if (schemaCreated && SAFE_SCHEMA_PATTERN.test(schemaName)) {
          await runAdminQuery(
            sessionDatabaseUrl,
            `drop schema "${schemaName}" cascade`,
          );
        }
      } finally {
        if (temporaryMigrationRoot) {
          await rm(temporaryMigrationRoot, { recursive: true, force: true });
        }
      }
    }
  }
}

async function runAdminQuery(
  connectionString: string,
  statement: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const pool = new Pool({ connectionString, max: 1 });
    try {
      await pool.query(statement);
      return;
    } catch (error) {
      if (attempt === 3 || !isTransientDatabaseError(error)) throw error;
    } finally {
      await pool.end();
    }
  }
}

function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    (typeof code === 'string' && TRANSIENT_DATABASE_CODES.has(code)) ||
    /^Connection terminated(?: unexpectedly)?$/u.test(error.message)
  );
}

function resolveSessionDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.hostname.endsWith('.neon.tech') && url.hostname.includes('-pooler.')) {
    url.hostname = url.hostname.replace('-pooler.', '.');
  }
  return url.toString();
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

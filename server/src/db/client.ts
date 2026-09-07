import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export type AppDatabase = NodePgDatabase<typeof schema>;
export type AppTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

export interface DatabaseHandle {
  pool: Pool;
  db: AppDatabase;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });

  return {
    pool,
    db,
    close: () => pool.end(),
  };
}

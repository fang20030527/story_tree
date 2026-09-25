import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const FILE_NAME = /^[0-9]{2}-[a-z_]+-[0-9]{3}\.sql$/u;

function quoted(name) {
  if (!IDENTIFIER.test(name)) throw new Error('Invalid snapshot identifier');
  return `"${name}"`;
}

function checkedFile(directory, file) {
  if (!FILE_NAME.test(file.name) || basename(file.name) !== file.name ||
      !Number.isSafeInteger(file.rows) || file.rows < 1 ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)) {
    throw new Error('Invalid snapshot file metadata');
  }
  const bytes = readFileSync(join(directory, file.name));
  if (bytes.byteLength !== file.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error('Snapshot file digest mismatch');
  }
  return bytes.toString('utf8');
}

function verifyTable(db, table) {
  const columns = table.columns.map(quoted);
  const order = table.keyColumns.map(quoted);
  const rows = db.prepare(
    `SELECT ${columns.join(', ')} FROM ${quoted(table.table)} ORDER BY ${order.join(', ')}`,
  ).all();
  if (rows.length !== table.rows) throw new Error(`Row count mismatch: ${table.table}`);
  const digest = createHash('sha256');
  for (const row of rows) {
    digest.update(JSON.stringify(table.columns.map((column) => row[column] ?? null)));
    digest.update('\n');
  }
  if (digest.digest('hex') !== table.sha256Rows) {
    throw new Error(`Row digest mismatch: ${table.table}`);
  }
  console.log(`${table.table}: ${rows.length} rows verified`);
}

function main() {
  const directory = resolve(process.argv[2] ?? '');
  if (!process.argv[2] || basename(resolve(directory, '..')) !== '.migration') {
    throw new Error('Pass a snapshot directory inside .migration');
  }
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.sourceSchema !== 'public' || manifest.tableCount !== 25 ||
      !Array.isArray(manifest.tables) || manifest.tables.length !== 25) {
    throw new Error('Invalid snapshot manifest');
  }
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for (const migration of ['0001_initial.sql', '0002_transaction_guards.sql', '0003_import_media.sql']) {
      db.exec(readFileSync(resolve('cloudflare/api/migrations', migration), 'utf8'));
    }
    for (const table of manifest.tables) {
      quoted(table.table);
      if (!Array.isArray(table.columns) || !Array.isArray(table.keyColumns) ||
          !Array.isArray(table.files) || !Number.isSafeInteger(table.rows)) {
        throw new Error('Invalid snapshot table metadata');
      }
      table.columns.forEach(quoted);
      table.keyColumns.forEach(quoted);
      for (const file of table.files) db.exec(checkedFile(directory, file));
      verifyTable(db, table);
    }
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (foreignKeys.length !== 0 || integrity.length !== 1 ||
        integrity[0].integrity_check !== 'ok') {
      throw new Error('Snapshot integrity check failed');
    }
    const pendingJobs = db.prepare(`
      SELECT kind, status, COUNT(*) AS count FROM jobs
      WHERE status IN ('queued', 'running') GROUP BY kind, status
    `).all();
    console.log(`Pending jobs in this snapshot: ${JSON.stringify(pendingJobs)}`);
    console.log('Local D1 snapshot rehearsal passed. No remote data was changed.');
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  // SQLite diagnostics can include private SQL literals. Never print them.
  const message = error?.message;
  console.error(typeof message === 'string' &&
    /^(?:Row count mismatch|Row digest mismatch|Snapshot|Invalid|Pass)/u.test(message)
    ? message : 'Local D1 snapshot rehearsal failed');
  process.exitCode = 1;
}

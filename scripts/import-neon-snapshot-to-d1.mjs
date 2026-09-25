import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

// Run only against the dedicated replacement database after applying the
// versioned D1 schema. Snapshot files contain private user data and stay in
// the Git-ignored .migration directory.
const DATABASE_ID = '9466eeba-614c-4eac-8b97-8d71a781dfbb';
const MAX_SQL_BYTES = 512 * 1024;
const PAGE_SIZE = 200;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const FILE_NAME = /^[0-9]{2}-[a-z_]+-[0-9]{3}\.sql$/u;

function identifier(name) {
  if (!IDENTIFIER.test(name)) throw new Error('Invalid snapshot identifier');
  return `"${name}"`;
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertHash(value) {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('Invalid snapshot digest');
}

async function d1Query(sql) {
  const accountId = requireValue(process.env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID');
  const token = requireValue(process.env.CLOUDFLARE_D1_API_TOKEN, 'CLOUDFLARE_D1_API_TOKEN');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true || !Array.isArray(payload.result) ||
      payload.result.some((item) => item.success !== true)) {
    // API error messages can contain the original SQL and user data.
    const code = payload.errors?.[0]?.code;
    throw new Error(`D1 request failed (HTTP ${response.status}, code ${Number.isSafeInteger(code) ? code : 'unknown'})`);
  }
  return payload.result;
}

async function selectRows(sql) {
  const results = await d1Query(sql);
  if (results.length !== 1 || !Array.isArray(results[0].results)) {
    throw new Error('Unexpected D1 query shape');
  }
  return results[0].results;
}

async function countRows(table) {
  const rows = await selectRows(`SELECT COUNT(*) AS count FROM ${identifier(table)}`);
  const count = Number(rows[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid D1 row count');
  return count;
}

async function loadSnapshot(directory) {
  const raw = await readFile(join(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.sourceSchema !== 'public' || !Array.isArray(manifest.tables) ||
      manifest.tableCount !== 25 || manifest.tables.length !== 25) {
    throw new Error('Snapshot manifest does not match the application schema');
  }
  const names = new Set();
  for (const table of manifest.tables) {
    identifier(table.table);
    if (names.has(table.table) || !Number.isSafeInteger(table.rows) || table.rows < 0 ||
        !Array.isArray(table.columns) || !Array.isArray(table.keyColumns) ||
        !Array.isArray(table.files)) {
      throw new Error('Invalid snapshot table manifest');
    }
    names.add(table.table);
    table.columns.forEach(identifier);
    table.keyColumns.forEach(identifier);
    if (table.keyColumns.length === 0 || table.columns.length === 0 ||
        table.keyColumns.some((key) => !table.columns.includes(key))) {
      throw new Error('Snapshot has no stable row order');
    }
    assertHash(table.sha256Rows);
    let totalRows = 0;
    for (const file of table.files) {
      if (!FILE_NAME.test(file.name) || basename(file.name) !== file.name ||
          !Number.isSafeInteger(file.rows) || file.rows < 1 ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_SQL_BYTES) {
        throw new Error('Invalid snapshot file manifest');
      }
      assertHash(file.sha256);
      totalRows += file.rows;
    }
    if (totalRows !== table.rows) throw new Error('Snapshot row count is inconsistent');
  }
  return manifest;
}

async function ensureSchema(manifest) {
  const rows = await selectRows("SELECT name FROM sqlite_master WHERE type = 'table'");
  const found = new Set(rows.map((row) => row.name));
  if (!found.has('d1_migrations') || !found.has('api_rate_limits') ||
      manifest.tables.some((table) => !found.has(table.table))) {
    throw new Error('D1 schema migration 0001 has not been applied');
  }
}

async function verifyTable(table) {
  const columns = table.columns.map(identifier).join(', ');
  const orderBy = table.keyColumns.map(identifier).join(', ');
  const digest = createHash('sha256');
  for (let offset = 0; offset < table.rows; offset += PAGE_SIZE) {
    const rows = await selectRows(
      `SELECT ${columns} FROM ${identifier(table.table)} ORDER BY ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    );
    if (rows.length !== Math.min(PAGE_SIZE, table.rows - offset)) {
      throw new Error('D1 table changed during verification');
    }
    for (const row of rows) {
      digest.update(JSON.stringify(table.columns.map((name) => row[name] ?? null)));
      digest.update('\n');
    }
  }
  if (digest.digest('hex') !== table.sha256Rows) {
    throw new Error(`Snapshot digest mismatch in ${table.table}`);
  }
}

async function importTable(directory, table) {
  let current = await countRows(table.table);
  const boundaries = [0];
  for (const file of table.files) boundaries.push(boundaries.at(-1) + file.rows);
  const nextFile = boundaries.indexOf(current);
  if (nextFile < 0) throw new Error(`D1 table ${table.table} has an incomplete import`);

  for (let index = nextFile; index < table.files.length; index += 1) {
    const file = table.files[index];
    const bytes = await readFile(join(directory, file.name));
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error('Snapshot file digest mismatch');
    }
    await d1Query(bytes.toString('utf8'));
    current = await countRows(table.table);
    if (current !== boundaries[index + 1]) {
      throw new Error(`D1 table ${table.table} row count changed unexpectedly`);
    }
  }
  if (current !== table.rows) throw new Error(`D1 table ${table.table} row count mismatch`);
  await verifyTable(table);
  console.log(`${table.table}: ${current} rows verified`);
}

async function main() {
  const directoryArg = process.argv[2];
  if (!directoryArg) throw new Error('Snapshot directory is required');
  const directory = resolve(directoryArg);
  const manifest = await loadSnapshot(directory);
  console.log(`Snapshot: ${manifest.tableCount} tables, ${manifest.tables.reduce((sum, table) => sum + table.rows, 0)} rows`);
  if (process.argv[3] !== '--apply') {
    console.log('No D1 changes made. Pass --apply to import.');
    return;
  }
  await ensureSchema(manifest);
  for (const table of manifest.tables) await importTable(directory, table);
  const foreignKeyIssues = await selectRows('PRAGMA foreign_key_check');
  // Cloudflare D1 rejects integrity_check with SQLITE_AUTH, but permits
  // quick_check. Row digests above and foreign_key_check cover the remaining
  // migration-specific consistency checks.
  const quickCheck = await selectRows('PRAGMA quick_check');
  if (foreignKeyIssues.length !== 0 || quickCheck.length !== 1 ||
      quickCheck[0].quick_check !== 'ok') {
    throw new Error('D1 consistency check failed');
  }
  console.log('D1 snapshot import completed with row digests, foreign keys and quick_check.');
}

main().catch((error) => {
  console.error(`D1 import failed: ${error?.message?.replace(/https?:\/\/\S+/gu, '[URL]') ?? 'UnknownError'}`);
  process.exitCode = 1;
});

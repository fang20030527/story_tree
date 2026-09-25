import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

async function load(directory) {
  const manifest = JSON.parse(await readFile(join(resolve(directory), 'manifest.json'), 'utf8'));
  if (manifest.sourceSchema !== 'public' || manifest.tableCount !== 25 ||
      !Array.isArray(manifest.tables) || manifest.tables.length !== 25) {
    throw new Error('Snapshot manifest is invalid');
  }
  const tables = new Map(manifest.tables.map((table) => [table.table, table]));
  if (tables.size !== 25) throw new Error('Snapshot table names are not unique');
  return tables;
}

const [previousDirectory, currentDirectory] = process.argv.slice(2);
if (!previousDirectory || !currentDirectory) {
  throw new Error('Pass the imported and final snapshot directories');
}
const previous = await load(previousDirectory);
const current = await load(currentDirectory);
const differences = [];
for (const [name, table] of current) {
  const before = previous.get(name);
  if (!before || before.rows !== table.rows || before.sha256Rows !== table.sha256Rows) {
    differences.push(name);
  }
}
if (previous.size !== current.size) differences.push('table-count');
if (differences.length > 0) {
  console.error(`Snapshot differs in: ${differences.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`${current.size} tables have identical row counts and digests.`);
}

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return groups.flat();
}

const exportDirectory = fileURLToPath(
  new URL('../../app/dist-smoke/', import.meta.url),
);
const secrets = ['EVOLINK_API_KEY', 'DATABASE_URL']
  .map((name) => ({ name, value: process.env[name] }))
  .filter(
    (entry): entry is { name: string; value: string } => Boolean(entry.value),
  );

for (const path of await filesUnder(exportDirectory)) {
  const content = await readFile(path);
  const text = content.toString('utf8');
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      throw new Error(`${secret.name} leaked into the client export`);
    }
  }
}

process.stdout.write(
  `Checked ${secrets.length} server secrets; no client leak found.\n`,
);

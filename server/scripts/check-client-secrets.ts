import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverOnlyNames = [
  'DATABASE_URL',
  'EVOLINK_API_KEY',
  'WECHAT_APP_SECRET',
  'RESEND_API_KEY',
  'PASSWORD_RESET_FROM_EMAIL',
  'WECHAT_API_BASE_URL',
  'EVOLINK_BASE_URL',
  'EVOLINK_TEXT_MODEL',
  'EVOLINK_TIMEOUT_MS',
  'PUBLIC_SERVER_ORIGIN',
  'EVOLINK_VISION_MODEL',
  'EVOLINK_VISION_TIMEOUT_MS',
  'IMPORT_MAX_TEXT_BYTES',
  'IMPORT_MAX_FILE_BYTES',
  'IMPORT_MAX_TOTAL_BYTES',
  'IMPORT_FETCH_MAX_BYTES',
  'IMPORT_FETCH_TIMEOUT_MS',
  'IMPORT_JOB_DEADLINE_MS',
  'COMPUTER_UPLOAD_TTL_MS',
  'IMPORT_ASSET_TTL_MS',
  'IMPORT_DRAFT_TTL_MS',
] as const;

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

const scanDirectories = [
  fileURLToPath(new URL('../../app/src/', import.meta.url)),
  fileURLToPath(new URL('../../app/dist-smoke/', import.meta.url)),
];
const secrets = ['EVOLINK_API_KEY', 'DATABASE_URL', 'WECHAT_APP_SECRET', 'RESEND_API_KEY']
  .map((name) => ({ name, value: process.env[name] }))
  .filter(
    (entry): entry is { name: string; value: string } => Boolean(entry.value),
  );

const files = (await Promise.all(scanDirectories.map(filesUnder))).flat();
for (const path of files) {
  const content = await readFile(path);
  const text = content.toString('utf8');
  for (const name of serverOnlyNames) {
    if (text.includes(name)) {
      throw new Error(`Server-only environment name found in client file: ${name}`);
    }
  }
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      throw new Error(`${secret.name} value found in client file`);
    }
  }
}

process.stdout.write(
  `Checked ${files.length} client files and ${secrets.length} configured server secrets; no client leak found.\n`,
);

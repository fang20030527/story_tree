import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const token = process.env.CLOUDFLARE_D1_API_TOKEN;
if (!token) throw new Error('CLOUDFLARE_D1_API_TOKEN is required');
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('CLOUDFLARE_ACCOUNT_ID is required');

// Use the short-lived D1-only token for schema changes. The token is passed
// through the child environment, never through command arguments or logs.
const child = spawn(process.execPath, [
  wrangler,
  'd1', 'migrations', 'apply', 'waikan-core', '--remote',
  '--config', 'cloudflare/api/wrangler.jsonc',
], {
  cwd: root,
  env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', () => {
  console.error('D1 migration could not start');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code === 0 ? 0 : 1;
});

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const token = process.env.CLOUDFLARE_D1_API_TOKEN;
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('CLOUDFLARE_ACCOUNT_ID is required');

// 优先使用 D1 专用 token；未配置时使用 Wrangler 官方 OAuth 登录。
// 不回退到用于 Worker 发布的通用 token，以免缺少 D1 权限或过期的凭据覆盖 OAuth。
// 凭据只通过子进程环境传递，不进入命令参数或日志。
const env = { ...process.env };
if (token) env.CLOUDFLARE_API_TOKEN = token;
else delete env.CLOUDFLARE_API_TOKEN;
const child = spawn(process.execPath, [
  wrangler,
  'd1', 'migrations', 'apply', 'waikan-core', '--remote',
  '--config', 'cloudflare/api/wrangler.jsonc',
], {
  cwd: root,
  env,
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

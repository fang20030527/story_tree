import { createCompatProxy } from './compat-proxy';

const value = process.env.CLOUDFLARE_API_ORIGIN;
if (!value) throw new Error('CLOUDFLARE_API_ORIGIN is required');
const origin = new URL(value);
if (origin.protocol !== 'https:' || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('CLOUDFLARE_API_ORIGIN must be an HTTPS origin');
}
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? '3000');
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT is invalid');
}

const server = createCompatProxy(origin);
server.listen(port, host);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close());
}

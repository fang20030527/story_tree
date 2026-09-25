import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createCompatProxy } from './compat-proxy';

const servers: Server[] = [];

async function listen(server: Server): Promise<URL> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local port');
  return new URL(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Render compatibility proxy', () => {
  it('forwards API paths, credentials and request bodies to the Cloudflare origin', async () => {
    const upstream = await listen(createServer(async (request, reply) => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      reply.writeHead(201, { 'content-type': 'application/json', 'x-request-id': 'upstream-id' });
      reply.end(JSON.stringify({
        path: request.url,
        authorization: request.headers.authorization,
        body,
      }));
    }));
    const proxy = await listen(createCompatProxy(upstream));
    const response = await fetch(new URL('/v1/auth/anonymous?test=1', proxy), {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: '{"ageConfirmed14Plus":true}',
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('upstream-id');
    expect(await response.json()).toEqual({
      path: '/v1/auth/anonymous?test=1',
      authorization: 'Bearer test-token',
      body: '{"ageConfirmed14Plus":true}',
    });
  });

  it('rejects paths outside the API and computer upload surface', async () => {
    const upstream = await listen(createServer((_request, reply) => reply.end('upstream')));
    const proxy = await listen(createCompatProxy(upstream));
    const response = await fetch(new URL('/internal', proxy));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('forwards an empty CORS preflight request', async () => {
    const upstream = await listen(createServer((request, reply) => {
      expect(request.method).toBe('OPTIONS');
      reply.writeHead(204, { 'access-control-allow-origin': 'https://example.test' });
      reply.end();
    }));
    const proxy = await listen(createCompatProxy(upstream));
    const response = await fetch(new URL('/v1/auth/email', proxy), { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.test');
  });
});

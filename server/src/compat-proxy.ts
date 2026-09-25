import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const HOP_HEADERS = new Set([
  'connection', 'host', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function allowedPath(path: string): boolean {
  return path === '/health/live' || path === '/health/ready' ||
    path === '/v1' || path.startsWith('/v1/') ||
    path === '/computer-upload' || path.startsWith('/computer-upload/');
}

function errorResponse(reply: ServerResponse, status: number): void {
  if (reply.headersSent) {
    reply.destroy();
    return;
  }
  reply.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  reply.end(JSON.stringify({
    error: {
      code: status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE',
      message: status === 404 ? '资源不存在' : '服务暂时不可用，请稍后重试',
      requestId: crypto.randomUUID(),
      retryable: status !== 404,
    },
  }));
}

async function forward(
  request: IncomingMessage,
  reply: ServerResponse,
  upstreamOrigin: URL,
): Promise<void> {
  const rawPath = request.url ?? '';
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) {
    errorResponse(reply, 404);
    return;
  }
  const target = new URL(rawPath, upstreamOrigin);
  if (target.origin !== upstreamOrigin.origin || !allowedPath(target.pathname)) {
    errorResponse(reply, 404);
    return;
  }
  const method = request.method ?? 'GET';
  if (!METHODS.has(method)) {
    reply.writeHead(405, { allow: [...METHODS].join(', '), 'cache-control': 'no-store' });
    reply.end();
    return;
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_HEADERS.has(name) || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  // Node fetch transparently decompresses upstream responses. Asking for an
  // uncompressed response also preserves byte ranges for legacy audio clients.
  headers.set('accept-encoding', 'identity');
  const hasBody = method !== 'GET' && method !== 'HEAD' &&
    (request.headers['content-length'] !== undefined ||
      request.headers['transfer-encoding'] !== undefined);
  const controller = new AbortController();
  reply.once('close', () => controller.abort());
  const upstream = await fetch(target, {
    method,
    headers,
    redirect: 'manual',
    signal: controller.signal,
    ...(hasBody ? { body: Readable.toWeb(request) as ReadableStream<Uint8Array>, duplex: 'half' as const } : {}),
  } as RequestInit & { duplex?: 'half' });

  const responseHeaders: Record<string, string | string[]> = {};
  for (const [name, value] of upstream.headers) {
    if (HOP_HEADERS.has(name) || name === 'content-length' || name === 'content-encoding' ||
        name === 'set-cookie') continue;
    responseHeaders[name] = value;
  }
  const cookies = (upstream.headers as Headers & { getSetCookie?(): string[] }).getSetCookie?.();
  if (cookies?.length) responseHeaders['set-cookie'] = cookies;
  reply.writeHead(upstream.status, responseHeaders);
  if (!upstream.body || method === 'HEAD') {
    reply.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), reply);
}

export function createCompatProxy(upstreamOrigin: URL): Server {
  return createServer((request, reply) => {
    void forward(request, reply, upstreamOrigin).catch(() => errorResponse(reply, 502));
  });
}

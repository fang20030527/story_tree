interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN?: string;
  API_SERVICE?: { fetch(request: Request): Promise<Response> };
  AUDIO_SERVICE?: { fetch(request: Request): Promise<Response> };
}

const ENTRY_PATH = /^\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js$/u;
const EDITORIAL_AUDIO_PATH = /^\/v1\/editorial\/audio\/[a-zA-Z0-9][a-zA-Z0-9-]{0,127}\/?$/u;

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/v1/') || pathname === '/computer-upload' ||
    pathname.startsWith('/computer-upload/');
}

async function forwardToApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.API_SERVICE && !env.API_ORIGIN) {
    throw new Error('API upstream is not configured');
  }
  const upstreamUrl = env.API_SERVICE
    ? url
    : new URL(`${url.pathname}${url.search}`, env.API_ORIGIN);
  const upstreamRequest = new Request(upstreamUrl, request);
  // The browser uses this Worker's origin. The API authenticates the request;
  // removing Origin avoids treating the proxy hop as a cross-origin browser call.
  upstreamRequest.headers.delete('origin');
  return env.API_SERVICE
    ? env.API_SERVICE.fetch(upstreamRequest)
    : fetch(upstreamRequest);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) {
        return Response.json({
          error: {
            code: 'UNAUTHORIZED',
            message: '请求来源不被允许',
            requestId: crypto.randomUUID(),
            retryable: false,
          },
        }, { status: 403, headers: { 'cache-control': 'no-store' } });
      }
      try {
        if (EDITORIAL_AUDIO_PATH.test(url.pathname) && env.AUDIO_SERVICE) {
          // Keep audio on the app's origin and pass Range headers to the R2 Worker.
          return await env.AUDIO_SERVICE.fetch(new Request(request));
        }
        return await forwardToApi(request, env, url);
      } catch {
        return Response.json({
          error: {
            code: 'UPSTREAM_UNAVAILABLE',
            message: '服务暂时不可用，请稍后重试',
            requestId: crypto.randomUUID(),
            retryable: true,
          },
        }, { status: 502, headers: { 'cache-control': 'no-store' } });
      }
    }
    if (ENTRY_PATH.test(url.pathname)) {
      const acceptsGzip = /(?:^|,)\s*gzip(?:\s*;|\s*,|\s*$)/iu.test(request.headers.get('accept-encoding') ?? '');
      if (!acceptsGzip) {
        return new Response('需要支持 gzip 的浏览器', { status: 406 });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
      }
      const compressedUrl = new URL(`${url.pathname}.gz`, url.origin);
      const asset = await env.ASSETS.fetch(new Request(compressedUrl, { method: request.method }));
      if (!asset.ok) return new Response(null, { status: 404 });
      const headers = new Headers(asset.headers);
      headers.set('content-type', 'application/javascript; charset=utf-8');
      headers.set('content-encoding', 'gzip');
      headers.set('vary', 'Accept-Encoding');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('x-content-type-options', 'nosniff');
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        status: 200,
        headers,
        encodeBody: 'manual',
      } as ResponseInit);
    }
    return env.ASSETS.fetch(request);
  },
};

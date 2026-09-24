interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API_ORIGIN: string;
}

const ENTRY_PATH = /^\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js$/u;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/')) {
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
      const upstreamUrl = new URL(`${url.pathname}${url.search}`, env.API_ORIGIN);
      // 浏览器访问同源 Worker；转发时移除 Origin，避免旧 API 的 CORS 拒绝。
      const upstreamRequest = new Request(upstreamUrl, request);
      upstreamRequest.headers.delete('origin');
      try {
        return await fetch(upstreamRequest);
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

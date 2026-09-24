interface AudioObject {
  size: number;
  httpEtag: string;
}

interface AudioBody extends AudioObject {
  body: ReadableStream<Uint8Array>;
}

interface AudioBucket {
  head(key: string): Promise<AudioObject | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<AudioBody | null>;
}

interface Env {
  AUDIO_BUCKET: AudioBucket;
}

const AUDIO_PATH = /^\/v1\/editorial\/audio\/([a-zA-Z0-9][a-zA-Z0-9-]{0,127})\/?$/u;

function corsHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range, If-Range',
    'access-control-expose-headers': 'Accept-Ranges, Content-Length, Content-Range, ETag',
    'access-control-max-age': '86400',
    'x-content-type-options': 'nosniff',
  });
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first))
    || (last !== undefined && !Number.isSafeInteger(last))) return null;
  if (first === undefined && (last === undefined || last <= 0)) return null;
  const start = first ?? Math.max(0, size - last!);
  const end = first !== undefined && last !== undefined ? Math.min(last, size - 1) : size - 1;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('allow', 'GET, HEAD, OPTIONS');
      return new Response(null, { status: 405, headers });
    }

    const path = new URL(request.url).pathname;
    const match = AUDIO_PATH.exec(path);
    if (!match) return new Response(null, { status: 404, headers });

    const key = `audio/2026/${match[1]}.mp3`;
    const object = await env.AUDIO_BUCKET.head(key);
    if (!object) return new Response(null, { status: 404, headers });

    const requestedRange = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    const rangeHeader = ifRange && ifRange !== object.httpEtag ? null : requestedRange;
    const range = rangeHeader ? parseRange(rangeHeader, object.size) : null;
    if (rangeHeader && !range) {
      headers.set('content-range', `bytes */${object.size}`);
      return new Response(null, { status: 416, headers });
    }

    headers.set('content-type', 'audio/mpeg');
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'public, max-age=3600');
    headers.set('etag', object.httpEtag);
    headers.set('content-length', String(range ? range.end - range.start + 1 : object.size));
    if (range) headers.set('content-range', `bytes ${range.start}-${range.end}/${object.size}`);

    if (request.method === 'HEAD') {
      return new Response(null, { status: range ? 206 : 200, headers });
    }

    const body = await env.AUDIO_BUCKET.get(key, range
      ? { range: { offset: range.start, length: range.end - range.start + 1 } }
      : undefined);
    if (!body) return new Response(null, { status: 404, headers: corsHeaders() });
    return new Response(body.body, { status: range ? 206 : 200, headers });
  },
};

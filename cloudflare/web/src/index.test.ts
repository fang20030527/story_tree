import { afterEach, describe, expect, it, vi } from 'vitest';

import web from './index';

afterEach(() => vi.unstubAllGlobals());

function assets() {
  return { fetch: vi.fn(async () => new Response('asset')) };
}

describe('Web API proxy', () => {
  it('forwards authenticated API requests over the cutover Service Binding', async () => {
    const apiFetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/v1/practices');
      expect(new URL(request.url).search).toBe('?view=all');
      expect(request.headers.get('authorization')).toBe('Bearer test-token');
      expect(request.headers.get('idempotency-key')).toBe('0123456789abcdef');
      expect(request.headers.has('origin')).toBe(false);
      expect(await request.text()).toBe('{"items":[]}');
      return Response.json({ practiceId: 'created' }, { status: 202 });
    });
    const externalFetch = vi.fn();
    vi.stubGlobal('fetch', externalFetch);
    const response = await web.fetch(new Request('https://waikan-web.example.org/v1/practices?view=all', {
      method: 'POST',
      headers: {
        origin: 'https://waikan-web.example.org',
        authorization: 'Bearer test-token',
        'idempotency-key': '0123456789abcdef',
      },
      body: '{"items":[]}',
    }), { ASSETS: assets(), API_SERVICE: { fetch: apiFetch } });
    expect(response.status).toBe(202);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it('forwards computer upload pages through the same binding', async () => {
    const apiFetch = vi.fn(async () => new Response('upload page'));
    const response = await web.fetch(new Request('https://waikan-web.example.org/computer-upload'), {
      ASSETS: assets(), API_SERVICE: { fetch: apiFetch },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('upload page');
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  it('keeps the current Render proxy available until cutover deployment', async () => {
    const externalFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://waikan-api.onrender.com/v1/practices');
      return Response.json({ status: 'ok' });
    });
    vi.stubGlobal('fetch', externalFetch);
    const response = await web.fetch(new Request('https://waikan-web.example.org/v1/practices'), {
      ASSETS: assets(), API_ORIGIN: 'https://waikan-api.onrender.com',
    });
    expect(response.status).toBe(200);
    expect(externalFetch).toHaveBeenCalledOnce();
  });

  it('rejects foreign browser origins before either upstream is called', async () => {
    const apiFetch = vi.fn();
    const response = await web.fetch(new Request('https://waikan-web.example.org/v1/practices', {
      headers: { origin: 'https://another.example.org' },
    }), { ASSETS: assets(), API_SERVICE: { fetch: apiFetch } });
    expect(response.status).toBe(403);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('serves EPUB covers through the existing API image route', async () => {
    const apiFetch = vi.fn(async (_request: Request) => new Response('cover', {
      headers: { 'content-type': 'image/webp' },
    }));
    const response = await web.fetch(new Request(
      'https://waikan-web.example.org/v1/editorial/images/7e5d43f3a3b29137011e2ed5.webp',
    ), { ASSETS: assets(), API_SERVICE: { fetch: apiFetch } });
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(new URL(apiFetch.mock.calls[0]![0].url).pathname)
      .toBe('/v1/editorial/images/7e5d43f3a3b29137011e2ed5.webp');
  });

  it('forwards original recordings and Range headers to the audio Worker', async () => {
    const apiFetch = vi.fn();
    const audioFetch = vi.fn(async (_request: Request) => new Response('audio', {
      status: 206,
      headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-1023/2220175' },
    }));
    const response = await web.fetch(new Request(
      'https://waikan-web.example.org/v1/editorial/audio/economist-2026-08-29-c4ca5c78b1f7b3d5',
      { headers: { range: 'bytes=0-1023' } },
    ), { ASSETS: assets(), API_SERVICE: { fetch: apiFetch }, AUDIO_SERVICE: { fetch: audioFetch } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-1023/2220175');
    expect(audioFetch.mock.calls[0]![0].headers.get('range')).toBe('bytes=0-1023');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

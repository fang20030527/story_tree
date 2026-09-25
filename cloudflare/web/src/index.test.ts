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
});

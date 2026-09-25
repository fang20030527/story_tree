import { describe, expect, it, vi } from 'vitest';

import { publicHtmlUrl, safeFetchHtmlOnCloudflare } from './safe-fetch';

const signal = new AbortController().signal;

describe('Cloudflare URL import egress policy', () => {
  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://metadata.google.internal/',
    'http://localhost/',
    'http://example.local/',
    'https://user:pass@publisher.org/',
    'https://publisher.org:8080/story',
    'ftp://publisher.org/story',
  ])('rejects %s before fetching', async (value) => {
    const requestPage = vi.fn<typeof fetch>();
    await expect(safeFetchHtmlOnCloudflare(value, {
      maxBytes: 100, timeoutMs: 1_000, signal, requestPage,
    })).rejects.toMatchObject({ code: 'IMPORT_FETCH_BLOCKED' });
    expect(requestPage).not.toHaveBeenCalled();
  });

  it('checks each manual redirect and sends no user credentials', async () => {
    const requestPage = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302, headers: { location: 'https://other-publisher.org/story' },
      }))
      .mockResolvedValueOnce(new Response('<html>article</html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
    await expect(safeFetchHtmlOnCloudflare('https://publisher.org/start', {
      maxBytes: 100, timeoutMs: 1_000, signal, requestPage,
    })).resolves.toEqual({ finalUrl: 'https://other-publisher.org/story', html: '<html>article</html>' });
    expect(requestPage).toHaveBeenCalledTimes(2);
    const init = requestPage.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('manual');
    expect(init?.method).toBe('GET');
    expect(JSON.stringify(init?.headers)).not.toMatch(/cookie|authorization|referer/iu);
  });

  it('blocks a redirect to a local address', async () => {
    const requestPage = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302, headers: { location: 'http://127.0.0.1/admin' },
    }));
    await expect(safeFetchHtmlOnCloudflare('https://publisher.org/start', {
      maxBytes: 100, timeoutMs: 1_000, signal, requestPage,
    })).rejects.toMatchObject({ code: 'IMPORT_FETCH_BLOCKED' });
    expect(requestPage).toHaveBeenCalledTimes(1);
  });

  it('bounds streamed response bytes and content type', async () => {
    const requestPage = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('too long', {
        status: 200, headers: { 'content-type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response('plain', {
        status: 200, headers: { 'content-type': 'text/plain' },
      }));
    await expect(safeFetchHtmlOnCloudflare('https://publisher.org/', {
      maxBytes: 3, timeoutMs: 1_000, signal, requestPage,
    })).rejects.toMatchObject({ code: 'IMPORT_TOO_LARGE' });
    await expect(safeFetchHtmlOnCloudflare('https://publisher.org/', {
      maxBytes: 100, timeoutMs: 1_000, signal, requestPage,
    })).rejects.toMatchObject({ code: 'IMPORT_UNSUPPORTED_TYPE' });
  });

  it('strips fragments from a valid URL', () => {
    expect(publicHtmlUrl('https://publisher.org/story#comments').toString())
      .toBe('https://publisher.org/story');
  });
});
